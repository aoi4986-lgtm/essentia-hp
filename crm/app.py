import os
import secrets
import psycopg2
import psycopg2.extras
from flask import Flask, request, jsonify, render_template, session, redirect, url_for
from datetime import date, timedelta
from functools import wraps

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', secrets.token_hex(32))

DATABASE_URL = os.environ.get('DATABASE_URL')
APP_PASSWORD = os.environ.get('APP_PASSWORD', 'changeme')

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
    cur.execute('''
        CREATE TABLE IF NOT EXISTS follow_history (
            id SERIAL PRIMARY KEY,
            customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
            date DATE NOT NULL,
            memo TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
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
    soon = (date.today() + timedelta(days=20)).isoformat()
    result = []
    for r in rows:
        d = dict(r)
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
        'INSERT INTO customers (name, company, contact, assignee, genre, next_follow_date, notes) VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id',
        (name, sanitize(data.get('company')), sanitize(data.get('contact')),
         sanitize(data.get('assignee')), sanitize(data.get('genre')),
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
        'UPDATE customers SET name=%s, company=%s, contact=%s, assignee=%s, genre=%s, next_follow_date=%s, notes=%s WHERE id=%s',
        (name, sanitize(data.get('company')), sanitize(data.get('contact')),
         sanitize(data.get('assignee')), sanitize(data.get('genre')),
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
        'INSERT INTO follow_history (customer_id, date, memo) VALUES (%s, %s, %s)',
        (cid, follow_date, sanitize(data.get('memo')))
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


init_db()

if __name__ == '__main__':
    app.run(port=5001, debug=False)
