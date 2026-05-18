import os
import secrets
import psycopg2
import psycopg2.extras
import anthropic
from flask import Flask, request, jsonify, render_template, session, redirect, url_for
from datetime import date, timedelta
from functools import wraps

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', secrets.token_hex(32))

DATABASE_URL = os.environ.get('DATABASE_URL')
APP_PASSWORD = os.environ.get('APP_PASSWORD', 'changeme')
ANTHROPIC_API_KEY = os.environ.get('ANTHROPIC_API_KEY')
ai_client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY) if ANTHROPIC_API_KEY else None

MAX_TEXT_LEN = 500


# --- DB ---

def get_db():
    conn = psycopg2.connect(DATABASE_URL)
    return conn


def init_db():
    conn = get_db()
    cur = conn.cursor()
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
    cur.execute("ALTER TABLE customers ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'")
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

@app.route('/login', methods=['GET', 'POST'])
def login():
    error = None
    if request.method == 'POST':
        if request.form.get('password') == APP_PASSWORD:
            session['logged_in'] = True
            return redirect(url_for('index'))
        error = 'パスワードが違います'
    return render_template('login.html', error=error)


@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))


@app.route('/')
@login_required
def index():
    return render_template('index.html')


@app.route('/customers', methods=['GET'])
@login_required
def list_customers():
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(
        'SELECT * FROM customers ORDER BY next_follow_date ASC NULLS LAST, created_at ASC'
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
    cur.execute(
        'INSERT INTO customers (name, company, contact, assignee, genre, area, next_follow_date, notes) VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id',
        (name, sanitize(data.get('company')), sanitize(data.get('contact')),
         sanitize(data.get('assignee')), sanitize(data.get('genre')),
         sanitize(data.get('area')),
         validate_date(data.get('next_follow_date')), sanitize(data.get('notes')))
    )
    new_id = cur.fetchone()[0]
    conn.commit()
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
    cur.execute(
        'UPDATE customers SET name=%s, company=%s, contact=%s, assignee=%s, genre=%s, area=%s, next_follow_date=%s, notes=%s WHERE id=%s',
        (name, sanitize(data.get('company')), sanitize(data.get('contact')),
         sanitize(data.get('assignee')), sanitize(data.get('genre')),
         sanitize(data.get('area')),
         validate_date(data.get('next_follow_date')), sanitize(data.get('notes')), cid)
    )
    conn.commit()
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
    ctx = f"顧客名: {c['name']}\n会社名: {c['company'] or '未登録'}\n連絡先: {c['contact'] or '未登録'}\n担当者: {c['assignee'] or '未登録'}\nジャンル: {c['genre'] or '未登録'}\n次回フォロー日: {c['next_follow_date'] or '未設定'}\nメモ: {c['notes'] or 'なし'}\n"
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
