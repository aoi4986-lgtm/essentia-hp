import os
import secrets
import csv
import io
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import psycopg2
import psycopg2.extras
import anthropic
from flask import Flask, request, jsonify, render_template, session, redirect, url_for, Response
from datetime import date, timedelta
from functools import wraps
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', secrets.token_hex(32))

DATABASE_URL = os.environ.get('DATABASE_URL')
APP_PASSWORD = os.environ.get('APP_PASSWORD', 'changeme')
ANTHROPIC_API_KEY = os.environ.get('ANTHROPIC_API_KEY')
ai_client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY) if ANTHROPIC_API_KEY else None

GMAIL_USER     = os.environ.get('GMAIL_USER', '')
GMAIL_APP_PW   = os.environ.get('GMAIL_APP_PASSWORD', '')
NOTIFY_TOKEN   = os.environ.get('NOTIFY_TOKEN', '')

MAX_TEXT_LEN = 500


# --- DB ---

def get_db():
    conn = psycopg2.connect(DATABASE_URL)
    return conn


def init_db():
    conn = get_db()
    cur = conn.cursor()
    # ユーザーテーブル
    cur.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            name TEXT NOT NULL,
            role TEXT DEFAULT 'member',
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    # 初回起動時に管理者を自動作成
    cur.execute('SELECT COUNT(*) FROM users')
    if cur.fetchone()[0] == 0:
        admin_email = os.environ.get('ADMIN_EMAIL', 'admin@example.com')
        admin_name  = os.environ.get('ADMIN_NAME', '管理者')
        admin_pw    = os.environ.get('APP_PASSWORD', 'changeme')
        cur.execute(
            'INSERT INTO users (email, password_hash, name, role) VALUES (%s, %s, %s, %s)',
            (admin_email.lower(), generate_password_hash(admin_pw), admin_name, 'admin')
        )
    conn.commit()  # ← 管理者ユーザーを先にコミット（以降の処理でロールバックされないように）
    cur.execute('''
        CREATE TABLE IF NOT EXISTS customers (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            company TEXT,
            contact TEXT,
            assignee TEXT,
            genre TEXT,
            next_follow_date DATE,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    cur.execute("ALTER TABLE customers ADD COLUMN IF NOT EXISTS genre TEXT")
    cur.execute("ALTER TABLE customers ADD COLUMN IF NOT EXISTS area TEXT")
    cur.execute("ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone TEXT")
    cur.execute("ALTER TABLE customers ADD COLUMN IF NOT EXISTS email_address TEXT")
    cur.execute("ALTER TABLE customers ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'")
    cur.execute("ALTER TABLE customers ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id)")
    cur.execute("ALTER TABLE customers ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id)")
    # 重複制約（name + company の組み合わせをユニークに）
    try:
        cur.execute('''
            CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_name_company
            ON customers (LOWER(TRIM(name)), LOWER(TRIM(COALESCE(company, ''))))
        ''')
        conn.commit()
    except Exception:
        conn.rollback()
    cur.execute('''
        CREATE TABLE IF NOT EXISTS follow_history (
            id SERIAL PRIMARY KEY,
            customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
            date DATE NOT NULL,
            memo TEXT,
            expectation TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    cur.execute("ALTER TABLE follow_history ADD COLUMN IF NOT EXISTS expectation TEXT")
    conn.commit()
    cur.close()
    conn.close()


# --- Auth ---

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('logged_in'):
            if request.is_json:
                return jsonify({'error': 'Unauthorized'}), 401
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated


def sanitize(value, max_len=MAX_TEXT_LEN):
    if value is None:
        return None
    return str(value).strip()[:max_len] or None


def validate_date(value):
    if not value:
        return None
    try:
        date.fromisoformat(value)
        return value
    except ValueError:
        return None


# --- Routes ---

@app.route('/debug-users')
def debug_users():
    """DBのユーザー状態を確認（パスワードは表示しない）"""
    conn = get_db()
    cur  = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute('SELECT id, email, name, role, is_active FROM users')
    users = [dict(u) for u in cur.fetchall()]
    cur.close()
    conn.close()
    return jsonify({'count': len(users), 'users': users})


@app.route('/setup')
def setup():
    """管理者を作成 or パスワードをリセットする（初期設定用）"""
    admin_email = os.environ.get('ADMIN_EMAIL', '')
    admin_name  = os.environ.get('ADMIN_NAME', '管理者')
    admin_pw    = os.environ.get('APP_PASSWORD', '')
    if not admin_email or not admin_pw:
        return 'ADMIN_EMAIL と APP_PASSWORD を環境変数に設定してください', 500
    conn = get_db()
    cur  = conn.cursor()
    cur.execute(
        '''INSERT INTO users (email, password_hash, name, role, is_active)
           VALUES (%s, %s, %s, 'admin', TRUE)
           ON CONFLICT (email) DO UPDATE
           SET password_hash = EXCLUDED.password_hash, is_active = TRUE''',
        (admin_email.lower(), generate_password_hash(admin_pw), admin_name)
    )
    conn.commit()
    cur.close()
    conn.close()
    return redirect(url_for('login'))


@app.route('/login', methods=['GET', 'POST'])
def login():
    error = None
    if request.method == 'POST':
        email    = request.form.get('email', '').strip().lower()
        password = request.form.get('password', '')
        conn = get_db()
        cur  = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute('SELECT * FROM users WHERE email=%s AND is_active=TRUE', (email,))
        user = cur.fetchone()
        cur.close()
        conn.close()
        if user and check_password_hash(user['password_hash'], password):
            session['logged_in'] = True
            session['user_id']   = user['id']
            session['user_name'] = user['name']
            session['user_role'] = user['role']
            return redirect(url_for('index'))
        error = 'メールアドレスまたはパスワードが違います'
    return render_template('login.html', error=error)


@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))


def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('logged_in'):
            return redirect(url_for('login'))
        if session.get('user_role') != 'admin':
            return '権限がありません', 403
        return f(*args, **kwargs)
    return decorated


@app.route('/')
@login_required
def index():
    conn = get_db()
    cur  = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT name FROM users WHERE is_active = TRUE ORDER BY name ASC")
    assignee_options = [r['name'] for r in cur.fetchall()]
    cur.close()
    conn.close()
    return render_template('index.html',
                           user_name=session.get('user_name', ''),
                           user_role=session.get('user_role', 'member'),
                           assignee_options=assignee_options)


@app.route('/customers', methods=['GET'])
@login_required
def list_customers():
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(
        '''SELECT c.*, u.name as created_by_name
           FROM customers c
           LEFT JOIN users u ON c.created_by = u.id
           ORDER BY c.next_follow_date ASC NULLS LAST, c.created_at ASC'''
    )
    rows = cur.fetchall()
    cur.close()
    conn.close()

    today = date.today().isoformat()
    soon = (date.today() + timedelta(days=30)).isoformat()
    result = []
    for r in rows:
        d = dict(r)
        account_status = d.get('status') or 'active'
        if d.get('next_follow_date'):
            nfd = d['next_follow_date'].isoformat()
            d['next_follow_date'] = nfd
            if nfd < today:
                d['status'] = 'overdue'
            elif nfd <= soon:
                d['status'] = 'soon'
            else:
                d['status'] = 'ok'
        else:
            d['status'] = 'none'
        d['account_status'] = account_status
        if d.get('created_at'):
            d['created_at'] = d['created_at'].isoformat()
        result.append(d)
    return jsonify(result)


@app.route('/customers', methods=['POST'])
@login_required
def add_customer():
    data = request.json or {}
    name = sanitize(data.get('name'))
    if not name:
        return jsonify({'error': '顧客名は必須です'}), 400
    conn = get_db()
    cur = conn.cursor()
    try:
        cur.execute(
            'INSERT INTO customers (name, company, phone, email_address, assignee, genre, area, next_follow_date, notes, created_by) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id',
            (name, sanitize(data.get('company')),
             sanitize(data.get('phone')), sanitize(data.get('email_address')),
             sanitize(data.get('assignee')), sanitize(data.get('genre')),
             sanitize(data.get('area')),
             validate_date(data.get('next_follow_date')), sanitize(data.get('notes')),
             session.get('user_id'))
        )
        new_id = cur.fetchone()[0]
        conn.commit()
    except Exception as e:
        conn.rollback()
        cur.close()
        conn.close()
        if 'idx_customers_name_company' in str(e):
            return jsonify({'error': '同じ顧客名・会社名の組み合わせがすでに登録されています'}), 409
        return jsonify({'error': '登録に失敗しました'}), 500
    cur.close()
    conn.close()
    return jsonify({'id': new_id}), 201


@app.route('/customers/<int:cid>', methods=['PUT'])
@login_required
def update_customer(cid):
    data = request.json or {}
    name = sanitize(data.get('name'))
    if not name:
        return jsonify({'error': '顧客名は必須です'}), 400
    conn = get_db()
    cur = conn.cursor()
    try:
        cur.execute(
            'UPDATE customers SET name=%s, company=%s, phone=%s, email_address=%s, assignee=%s, genre=%s, area=%s, next_follow_date=%s, notes=%s, updated_by=%s WHERE id=%s',
            (name, sanitize(data.get('company')),
             sanitize(data.get('phone')), sanitize(data.get('email_address')),
             sanitize(data.get('assignee')), sanitize(data.get('genre')),
             sanitize(data.get('area')),
             validate_date(data.get('next_follow_date')), sanitize(data.get('notes')),
             session.get('user_id'), cid)
        )
        conn.commit()
    except Exception as e:
        conn.rollback()
        cur.close()
        conn.close()
        if 'idx_customers_name_company' in str(e):
            return jsonify({'error': '同じ顧客名・会社名の組み合わせがすでに登録されています'}), 409
        return jsonify({'error': '更新に失敗しました'}), 500
    cur.close()
    conn.close()
    return jsonify({'ok': True})


@app.route('/customers/<int:cid>', methods=['DELETE'])
@login_required
def delete_customer(cid):
    conn = get_db()
    cur = conn.cursor()
    cur.execute('DELETE FROM customers WHERE id=%s', (cid,))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'ok': True})


@app.route('/customers/<int:cid>/follow', methods=['POST'])
@login_required
def add_follow(cid):
    data = request.json or {}
    follow_date = validate_date(data.get('date')) or date.today().isoformat()
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        'INSERT INTO follow_history (customer_id, date, memo, expectation) VALUES (%s, %s, %s, %s)',
        (cid, follow_date, sanitize(data.get('memo')), sanitize(data.get('expectation')))
    )
    next_date = validate_date(data.get('next_follow_date'))
    if next_date:
        cur.execute(
            'UPDATE customers SET next_follow_date=%s WHERE id=%s',
            (next_date, cid)
        )
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'ok': True})


@app.route('/customers/<int:cid>/end', methods=['POST'])
@login_required
def end_customer(cid):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("UPDATE customers SET status='ended', next_follow_date=NULL WHERE id=%s", (cid,))
    cur.execute(
        'INSERT INTO follow_history (customer_id, date, memo, expectation) VALUES (%s, %s, %s, %s)',
        (cid, date.today().isoformat(), 'フォロー終了', 'ended')
    )
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'ok': True})


@app.route('/customers/<int:cid>/reopen', methods=['POST'])
@login_required
def reopen_customer(cid):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("UPDATE customers SET status='active' WHERE id=%s", (cid,))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'ok': True})


@app.route('/customers/<int:cid>/history', methods=['GET'])
@login_required
def get_history(cid):
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(
        'SELECT * FROM follow_history WHERE customer_id=%s ORDER BY date DESC',
        (cid,)
    )
    rows = cur.fetchall()
    cur.close()
    conn.close()
    result = []
    for r in rows:
        d = dict(r)
        if d.get('date'):
            d['date'] = d['date'].isoformat()
        if d.get('created_at'):
            d['created_at'] = d['created_at'].isoformat()
        result.append(d)
    return jsonify(result)


@app.route('/admin/users')
@admin_required
def admin_users():
    conn = get_db()
    cur  = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute('SELECT id, email, name, role, is_active, created_at FROM users ORDER BY created_at ASC')
    users = [dict(u) for u in cur.fetchall()]
    cur.close()
    conn.close()
    for u in users:
        if u.get('created_at'):
            u['created_at'] = u['created_at'].isoformat()
    return render_template('admin.html',
                           users=users,
                           current_user_id=session.get('user_id'),
                           user_name=session.get('user_name', ''),
                           user_role=session.get('user_role', 'admin'))


@app.route('/admin/users', methods=['POST'])
@admin_required
def admin_add_user():
    data     = request.json or {}
    email    = sanitize(data.get('email'), 200)
    name     = sanitize(data.get('name'), 100)
    password = data.get('password', '')
    role     = data.get('role', 'member')
    if not email or not name or not password:
        return jsonify({'error': '全項目を入力してください'}), 400
    if len(password) < 6:
        return jsonify({'error': 'パスワードは6文字以上にしてください'}), 400
    if role not in ('admin', 'member'):
        role = 'member'
    conn = get_db()
    cur  = conn.cursor()
    try:
        cur.execute(
            'INSERT INTO users (email, password_hash, name, role) VALUES (%s, %s, %s, %s) RETURNING id',
            (email.lower(), generate_password_hash(password), name, role)
        )
        new_id = cur.fetchone()[0]
        conn.commit()
    except Exception:
        conn.rollback()
        cur.close()
        conn.close()
        return jsonify({'error': 'そのメールアドレスはすでに使われています'}), 409
    cur.close()
    conn.close()
    return jsonify({'id': new_id}), 201


@app.route('/admin/users/<int:uid>/toggle', methods=['POST'])
@admin_required
def admin_toggle_user(uid):
    if uid == session.get('user_id'):
        return jsonify({'error': '自分自身は変更できません'}), 400
    conn = get_db()
    cur  = conn.cursor()
    cur.execute('UPDATE users SET is_active = NOT is_active WHERE id=%s', (uid,))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'ok': True})


@app.route('/admin/users/<int:uid>', methods=['PUT'])
@admin_required
def admin_update_user(uid):
    data  = request.json or {}
    name  = sanitize(data.get('name'), 100)
    email = sanitize(data.get('email'), 200)
    role  = data.get('role', 'member')
    if not name or not email:
        return jsonify({'error': '名前とメールは必須です'}), 400
    if role not in ('admin', 'member'):
        role = 'member'
    conn = get_db()
    cur  = conn.cursor()
    try:
        cur.execute('UPDATE users SET name=%s, email=%s, role=%s WHERE id=%s',
                    (name, email.lower(), role, uid))
        conn.commit()
    except Exception:
        conn.rollback()
        cur.close()
        conn.close()
        return jsonify({'error': 'そのメールアドレスはすでに使われています'}), 409
    cur.close()
    conn.close()
    return jsonify({'ok': True})


@app.route('/admin/users/<int:uid>/delete', methods=['POST'])
@admin_required
def admin_delete_user(uid):
    if uid == session.get('user_id'):
        return jsonify({'error': '自分自身は削除できません'}), 400
    conn = get_db()
    cur  = conn.cursor()
    cur.execute('DELETE FROM users WHERE id=%s', (uid,))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'ok': True})


@app.route('/admin/users/<int:uid>/reset-password', methods=['POST'])
@admin_required
def admin_reset_password(uid):
    data     = request.json or {}
    password = data.get('password', '')
    if len(password) < 6:
        return jsonify({'error': 'パスワードは6文字以上にしてください'}), 400
    conn = get_db()
    cur  = conn.cursor()
    cur.execute('UPDATE users SET password_hash=%s WHERE id=%s', (generate_password_hash(password), uid))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'ok': True})


@app.route('/change-password', methods=['POST'])
@login_required
def change_password():
    data         = request.json or {}
    current_pw   = data.get('current_password', '')
    new_pw       = data.get('new_password', '')
    if len(new_pw) < 6:
        return jsonify({'error': 'パスワードは6文字以上にしてください'}), 400
    conn = get_db()
    cur  = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute('SELECT password_hash FROM users WHERE id=%s', (session.get('user_id'),))
    user = cur.fetchone()
    if not user or not check_password_hash(user['password_hash'], current_pw):
        cur.close()
        conn.close()
        return jsonify({'error': '現在のパスワードが違います'}), 400
    cur2 = conn.cursor()
    cur2.execute('UPDATE users SET password_hash=%s WHERE id=%s', (generate_password_hash(new_pw), session.get('user_id')))
    conn.commit()
    cur.close()
    cur2.close()
    conn.close()
    return jsonify({'ok': True})


@app.route('/stats')
@login_required
def stats():
    return render_template('stats.html',
                           user_name=session.get('user_name', ''),
                           user_role=session.get('user_role', 'member'))


@app.route('/stats/data')
@login_required
def stats_data():
    conn = get_db()
    cur  = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # 担当者別フォロー件数（今月）
    cur.execute('''
        SELECT u.name as assignee, COUNT(*) as count
        FROM follow_history fh
        JOIN customers c ON fh.customer_id = c.id
        LEFT JOIN users u ON c.assignee = u.name
        WHERE DATE_TRUNC('month', fh.date) = DATE_TRUNC('month', CURRENT_DATE)
        GROUP BY u.name ORDER BY count DESC
    ''')
    monthly_follows = [dict(r) for r in cur.fetchall()]

    # 担当者別フォロー件数（累計）
    cur.execute('''
        SELECT COALESCE(c.assignee, '未設定') as assignee, COUNT(*) as count
        FROM follow_history fh
        JOIN customers c ON fh.customer_id = c.id
        GROUP BY c.assignee ORDER BY count DESC LIMIT 10
    ''')
    total_follows = [dict(r) for r in cur.fetchall()]

    # ジャンル別顧客数
    cur.execute('''
        SELECT COALESCE(genre, '未設定') as genre, COUNT(*) as count
        FROM customers WHERE status != 'ended'
        GROUP BY genre ORDER BY count DESC
    ''')
    by_genre = [dict(r) for r in cur.fetchall()]

    # エリア別顧客数
    cur.execute('''
        SELECT COALESCE(area, '未設定') as area, COUNT(*) as count
        FROM customers WHERE status != 'ended'
        GROUP BY area ORDER BY count DESC
    ''')
    by_area = [dict(r) for r in cur.fetchall()]

    # 月別フォロー記録数（過去6ヶ月）
    cur.execute('''
        SELECT TO_CHAR(DATE_TRUNC('month', date), 'YYYY-MM') as month, COUNT(*) as count
        FROM follow_history
        WHERE date >= CURRENT_DATE - INTERVAL '6 months'
        GROUP BY month ORDER BY month ASC
    ''')
    monthly_trend = [dict(r) for r in cur.fetchall()]

    # サマリー数値
    cur.execute("SELECT COUNT(*) FROM customers WHERE status != 'ended'")
    total_active = cur.fetchone()['count']
    cur.execute("SELECT COUNT(*) FROM customers WHERE status = 'ended'")
    total_ended = cur.fetchone()['count']
    cur.execute("SELECT COUNT(*) FROM follow_history WHERE DATE_TRUNC('month', date) = DATE_TRUNC('month', CURRENT_DATE)")
    follows_this_month = cur.fetchone()['count']
    cur.execute("SELECT COUNT(*) FROM customers WHERE next_follow_date < CURRENT_DATE AND status != 'ended'")
    overdue_count = cur.fetchone()['count']

    cur.close()
    conn.close()
    return jsonify({
        'monthly_follows': monthly_follows,
        'total_follows': total_follows,
        'by_genre': by_genre,
        'by_area': by_area,
        'monthly_trend': monthly_trend,
        'summary': {
            'total_active': total_active,
            'total_ended': total_ended,
            'follows_this_month': follows_this_month,
            'overdue_count': overdue_count,
        }
    })


def send_email(to_addr, subject, body):
    msg = MIMEMultipart('alternative')
    msg['Subject'] = subject
    msg['From']    = GMAIL_USER
    msg['To']      = to_addr
    msg.attach(MIMEText(body, 'html', 'utf-8'))
    with smtplib.SMTP_SSL('smtp.gmail.com', 465) as smtp:
        smtp.login(GMAIL_USER, GMAIL_APP_PW)
        smtp.send_message(msg)


@app.route('/notify')
def notify():
    """担当者ごとに期限超過・期限間近の顧客をメール通知する"""
    token = request.args.get('token', '')
    if not NOTIFY_TOKEN or token != NOTIFY_TOKEN:
        return jsonify({'error': 'Unauthorized'}), 401
    if not GMAIL_USER or not GMAIL_APP_PW:
        return jsonify({'error': 'Gmail設定がありません'}), 500

    today = date.today()
    d3    = (today + timedelta(days=3)).isoformat()
    today_str = today.isoformat()

    conn = get_db()
    cur  = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    # 担当者名とメールアドレスの対応を取得
    cur.execute("SELECT name, email FROM users WHERE is_active = TRUE AND email != ''")
    user_emails = {u['name']: u['email'] for u in cur.fetchall()}

    # 期限超過・3日以内の顧客を取得
    cur.execute("""
        SELECT name, company, assignee, next_follow_date
        FROM customers
        WHERE status != 'ended'
          AND next_follow_date IS NOT NULL
          AND next_follow_date <= %s
        ORDER BY next_follow_date ASC
    """, (d3,))
    customers_to_notify = cur.fetchall()
    cur.close()
    conn.close()

    # 担当者ごとに分類
    by_assignee = {}
    for c in customers_to_notify:
        a = c['assignee'] or '未設定'
        if a not in by_assignee:
            by_assignee[a] = {'overdue': [], 'soon': []}
        nfd = c['next_follow_date'].isoformat()
        if nfd < today_str:
            by_assignee[a]['overdue'].append(c)
        else:
            by_assignee[a]['soon'].append(c)

    sent = []
    skipped = []
    for assignee, data in by_assignee.items():
        if not data['overdue'] and not data['soon']:
            continue
        email = user_emails.get(assignee)
        if not email:
            skipped.append(assignee)
            continue

        overdue_rows = ''.join([
            f"<tr><td style='padding:6px 12px;border-bottom:1px solid #fee2e2'><b>{c['name']}</b>{' / ' + c['company'] if c['company'] else ''}</td>"
            f"<td style='padding:6px 12px;border-bottom:1px solid #fee2e2;color:#ef4444'>{c['next_follow_date'].isoformat()}</td></tr>"
            for c in data['overdue']
        ])
        soon_rows = ''.join([
            f"<tr><td style='padding:6px 12px;border-bottom:1px solid #fef3c7'><b>{c['name']}</b>{' / ' + c['company'] if c['company'] else ''}</td>"
            f"<td style='padding:6px 12px;border-bottom:1px solid #fef3c7;color:#f59e0b'>{c['next_follow_date'].isoformat()}</td></tr>"
            for c in data['soon']
        ])

        overdue_section = f"""
        <h3 style='color:#ef4444;margin:20px 0 8px'>⚠ 期限超過（{len(data['overdue'])}件）</h3>
        <table style='width:100%;border-collapse:collapse;background:#fef2f2;border-radius:8px'>
          <tr style='background:#fee2e2'><th style='padding:6px 12px;text-align:left'>顧客名</th><th style='padding:6px 12px;text-align:left'>期限日</th></tr>
          {overdue_rows}
        </table>""" if data['overdue'] else ''

        soon_section = f"""
        <h3 style='color:#f59e0b;margin:20px 0 8px'>🔥 3日以内（{len(data['soon'])}件）</h3>
        <table style='width:100%;border-collapse:collapse;background:#fffbeb;border-radius:8px'>
          <tr style='background:#fef3c7'><th style='padding:6px 12px;text-align:left'>顧客名</th><th style='padding:6px 12px;text-align:left'>期限日</th></tr>
          {soon_rows}
        </table>""" if data['soon'] else ''

        total = len(data['overdue']) + len(data['soon'])
        body = f"""
        <div style='font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px'>
          <h2 style='color:#059669'>📋 本日のフォロー確認</h2>
          <p style='color:#475569'>{today_str}　担当: {assignee}さん</p>
          <p style='color:#1e293b'>フォローが必要な顧客が <b>{total}件</b> あります。</p>
          {overdue_section}
          {soon_section}
          <div style='margin-top:24px'>
            <a href='https://essentia-crm.onrender.com' style='background:linear-gradient(135deg,#059669,#0ea5e9);color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:bold'>CRMを開く</a>
          </div>
          <p style='color:#94a3b8;font-size:12px;margin-top:24px'>このメールは自動送信です。</p>
        </div>"""

        try:
            send_email(email, f'【フォロー管理】本日の確認 {total}件 ({today_str})', body)
            sent.append(assignee)
        except Exception as e:
            skipped.append(f'{assignee}({str(e)})')

    return jsonify({'sent': sent, 'skipped': skipped, 'date': today_str})


@app.route('/export/csv', methods=['GET'])
@login_required
def export_csv():
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute('SELECT * FROM customers ORDER BY created_at ASC')
    customers = cur.fetchall()
    cur.execute('SELECT * FROM follow_history ORDER BY customer_id ASC, date DESC')
    history_rows = cur.fetchall()
    cur.close()
    conn.close()

    # 顧客IDごとに履歴をまとめる
    history_map = {}
    for h in history_rows:
        cid = h['customer_id']
        if cid not in history_map:
            history_map[cid] = []
        exp = h.get('expectation') or ''
        exp_label = {'high': '高い', 'mid': '普通', 'low': '低い', 'ended': '終了'}.get(exp, exp)
        history_map[cid].append(f"{h['date']} [{exp_label}] {h['memo'] or ''}")

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        'ID', '顧客名', '会社名', '電話番号', 'メールアドレス', '担当者', 'ジャンル', 'エリア',
        'ステータス', '次回フォロー日', 'メモ', '登録日', 'フォロー履歴'
    ])
    for c in customers:
        status = c.get('status') or 'active'
        status_label = '終了済み' if status == 'ended' else 'アクティブ'
        history_text = ' / '.join(history_map.get(c['id'], []))
        writer.writerow([
            c['id'], c['name'], c['company'] or '',
            c.get('phone') or '', c.get('email_address') or '',
            c['assignee'] or '', c['genre'] or '', c.get('area') or '',
            status_label,
            c['next_follow_date'].isoformat() if c.get('next_follow_date') else '',
            c['notes'] or '',
            c['created_at'].strftime('%Y-%m-%d') if c.get('created_at') else '',
            history_text
        ])

    output.seek(0)
    bom = '﻿'  # Excel で文字化けしないよう BOM 付き UTF-8
    csv_data = bom + output.getvalue()
    filename = f"顧客リスト_{date.today().isoformat()}.csv"
    return Response(
        csv_data.encode('utf-8-sig'),
        mimetype='text/csv',
        headers={'Content-Disposition': f'attachment; filename="{filename}"'}
    )


CHAT_SYSTEM = """あなたは営業担当者の優秀なパートナーです。顧客情報とフォロー履歴をもとに、担当者と一緒に次のアクションを考えます。
以下のルールを守ってください：
- 一方的に提案するのではなく、担当者に質問しながら一緒に考える
- 返答は簡潔に（3〜5文以内）
- 具体的で実践的なアドバイスをする
- 日本語で話す
- 最初の返答では顧客の状況を簡単に整理して、何を相談したいか聞く"""


def build_customer_context(cid):
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute('SELECT * FROM customers WHERE id=%s', (cid,))
    c = cur.fetchone()
    cur.execute('SELECT * FROM follow_history WHERE customer_id=%s ORDER BY date DESC LIMIT 5', (cid,))
    history = cur.fetchall()
    cur.close()
    conn.close()
    if not c:
        return None, None
    ctx = f"顧客名: {c['name']}\n会社名: {c['company'] or '未登録'}\n電話番号: {c.get('phone') or '未登録'}\nメール: {c.get('email_address') or '未登録'}\n担当者: {c['assignee'] or '未登録'}\nジャンル: {c['genre'] or '未登録'}\nエリア: {c.get('area') or '未登録'}\n次回フォロー日: {c['next_follow_date'] or '未設定'}\nメモ: {c['notes'] or 'なし'}\n"
    if history:
        ctx += "\n【フォロー履歴（直近5件）】\n"
        for h in history:
            ctx += f"- {h['date']}: {h['memo'] or 'メモなし'}\n"
    return c, ctx


@app.route('/customers/<int:cid>/chat', methods=['POST'])
@login_required
def ai_chat(cid):
    if not ai_client:
        return jsonify({'error': 'AI機能が設定されていません'}), 500
    c, ctx = build_customer_context(cid)
    if not c:
        return jsonify({'error': '顧客が見つかりません'}), 404

    data = request.json or {}
    messages = data.get('messages', [])

    system = f"{CHAT_SYSTEM}\n\n【顧客情報】\n{ctx}"

    from flask import Response, stream_with_context
    def generate():
        with ai_client.messages.stream(
            model='claude-haiku-4-5-20251001',
            max_tokens=512,
            system=system,
            messages=messages
        ) as stream:
            for text in stream.text_stream:
                yield f"data: {text}\n\n"
        yield "data: [DONE]\n\n"

    return Response(stream_with_context(generate()), mimetype='text/event-stream',
                    headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})


@app.route('/customers/<int:cid>/suggest', methods=['POST'])
@login_required
def ai_suggest(cid):
    if not ai_client:
        return jsonify({'error': 'AI機能が設定されていません'}), 500
    c, ctx = build_customer_context(cid)
    if not c:
        return jsonify({'error': '顧客が見つかりません'}), 404
    msg = ai_client.messages.create(
        model='claude-haiku-4-5-20251001',
        max_tokens=600,
        messages=[{
            'role': 'user',
            'content': f"以下の顧客情報とフォロー履歴をもとに、次回フォロー時に話すべき内容を3〜5点、箇条書きで提案してください。\n\n{ctx}"
        }]
    )
    return jsonify({'result': msg.content[0].text})


@app.route('/customers/<int:cid>/email', methods=['POST'])
@login_required
def ai_email(cid):
    if not ai_client:
        return jsonify({'error': 'AI機能が設定されていません'}), 500
    c, ctx = build_customer_context(cid)
    if not c:
        return jsonify({'error': '顧客が見つかりません'}), 404
    msg = ai_client.messages.create(
        model='claude-haiku-4-5-20251001',
        max_tokens=800,
        messages=[{
            'role': 'user',
            'content': f"以下の顧客情報とフォロー履歴をもとに、丁寧で自然な日本語のフォローメール文を作成してください。件名と本文を含めてください。\n\n{ctx}"
        }]
    )
    return jsonify({'result': msg.content[0].text})


init_db()

if __name__ == '__main__':
    app.run(port=5001, debug=False)
