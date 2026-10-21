const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Database Setup (SQLite file-based)
const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error('Database opening error: ', err.message);
    else console.log('Connected to SQLite Database.');
});

// Tables Creation
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        email TEXT UNIQUE,
        referral_code TEXT UNIQUE,
        referred_by INTEGER,
        wallet_balance REAL DEFAULT 0.0
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS referral_rewards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        referrer_id INTEGER,
        referee_id INTEGER,
        reward_amount REAL,
        status TEXT DEFAULT 'Approved'
    )`);
});

// Helper: Unique Referral Code Generator
function generateReferralCode(name) {
    const cleanName = name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 3).toUpperCase();
    const randomHex = crypto.randomBytes(2).toString('hex').toUpperCase();
    return `${cleanName || 'USR'}-${randomHex}`;
}

// ---------------- ROUTES ---------------- //

// 1. Referral Link Click Handler (`/ref/CODE`)
app.get('/ref/:code', (req, res) => {
    const { code } = req.params;
    res.cookie('ref_code', code, { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: true });
    res.redirect('/');
});

// 2. Signup API Endpoint
app.post('/api/signup', (req, res) => {
    const { name, email } = req.body;
    if (!name || !email) {
        return res.status(400).json({ error: "Name and Email are required!" });
    }

    const referralCode = generateReferralCode(name);
    const refCodeFromCookie = req.cookies.ref_code || null;

    db.serialize(() => {
        let findReferrerQuery = `SELECT id FROM users WHERE referral_code = ?`;
        db.get(findReferrerQuery, [refCodeFromCookie], (err, referrer) => {
            let referredById = referrer ? referrer.id : null;

            let insertUserQuery = `INSERT INTO users (name, email, referral_code, referred_by) VALUES (?, ?, ?, ?)`;
            db.run(insertUserQuery, [name, email, referralCode, referredById], function(err) {
                if (err) {
                    return res.status(400).json({ error: "Email already registered or error occurred!" });
                }

                const newUserId = this.lastID;

                if (referredById) {
                    const rewardAmount = 50.0; 
                    db.run(`INSERT INTO referral_rewards (referrer_id, referee_id, reward_amount) VALUES (?, ?, ?)`, 
                        [referredById, newUserId, rewardAmount]);
                    
                    db.run(`UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?`, [rewardAmount, referredById]);
                }

                res.json({ 
                    success: true, 
                    userId: newUserId, 
                    name, 
                    referralCode,
                    referralLink: `${req.protocol}://${req.get('host')}/ref/${referralCode}`
                });
            });
        });
    });
});

// 3. Get User Stats API
app.get('/api/user/:id', (req, res) => {
    const userId = req.params.id;
    db.get(`SELECT id, name, email, referral_code, wallet_balance FROM users WHERE id = ?`, [userId], (err, user) => {
        if (!user) return res.status(404).json({ error: "User not found" });

        db.all(`SELECT r.referee_id, u.name as referee_name, r.reward_amount, r.status 
                FROM referral_rewards r 
                JOIN users u ON r.referee_id = u.id 
                WHERE r.referrer_id = ?`, [userId], (err, referrals) => {
            res.json({ user, referrals });
        });
    });
});

// 4. Frontend UI
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Referral System Live Test</title>
            <style>
                body { font-family: Arial, sans-serif; background: #f4f7f6; margin: 0; padding: 20px; color: #333; }
                .container { max-width: 600px; margin: 0 auto; background: #fff; padding: 30px; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.1); }
                h2 { color: #007bff; text-align: center; }
                .form-group { margin-bottom: 15px; }
                label { display: block; margin-bottom: 5px; font-weight: bold; }
                input { width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; }
                button { background: #007bff; color: white; border: none; padding: 10px 15px; width: 100%; border-radius: 4px; font-size: 16px; cursor: pointer; }
                button:hover { background: #0056b3; }
                .card { background: #e9ecef; padding: 15px; border-radius: 6px; margin-top: 20px; }
                .hidden { display: none; }
            </style>
        </head>
        <body>
            <div class="container">
                <h2>Referral & Tracking System</h2>
                <div id="signup-section">
                    <p id="ref-notice" style="color: #e83e8c; font-weight: bold;"></p>
                    <div class="form-group">
                        <label>Your Name</label>
                        <input type="text" id="name" placeholder="Enter name">
                    </div>
                    <div class="form-group">
                        <label>Email Address</label>
                        <input type="email" id="email" placeholder="Enter email">
                    </div>
                    <button onclick="registerUser()">Register Now</button>
                </div>

                <div id="dashboard-section" class="hidden">
                    <div class="card">
                        <h3>Welcome, <span id="dash-name"></span>!</h3>
                        <p><strong>Your Wallet Balance:</strong> ₹<span id="dash-wallet">0</span></p>
                        <p><strong>Your Referral Link:</strong></p>
                        <input type="text" id="dash-link" readonly onclick="this.select()">
                        <p style="font-size: 12px; color: #666; margin-top: 5px;">Click to copy and share with friends!</p>
                    </div>
                    <div class="card">
                        <h4>Your Successful Referrals</h4>
                        <ul id="referral-list">
                            <li>No referrals yet. Share your link!</li>
                        </ul>
                    </div>
                    <button onclick="logout()" style="background: #dc3545; margin-top: 15px;">Logout / Switch User</button>
                </div>
            </div>

            <script>
                function getCookie(name) {
                    const value = "; " + document.cookie;
                    const parts = value.split("; " + name + "=");
                    if (parts.length === 2) return parts.pop().split(";").shift();
                }

                window.onload = function() {
                    const refCode = getCookie('ref_code');
                    if(refCode) {
                        document.getElementById('ref-notice').innerText = "You were invited via a referral link! Code: " + refCode;
                    }

                    const savedUserId = localStorage.getItem('userId');
                    if(savedUserId) {
                        loadDashboard(savedUserId);
                    }
                };

                async function registerUser() {
                    const name = document.getElementById('name').value;
                    const email = document.getElementById('email').value;

                    if(!name || !email) {
                        alert('Please fill all fields');
                        return;
                    }

                    const response = await fetch('/api/signup', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name, email })
                    });
                    const data = await response.json();

                    if(data.success) {
                        localStorage.setItem('userId', data.userId);
                        loadDashboard(data.userId);
                    } else {
                        alert(data.error || 'Registration failed');
                    }
                }

                async function loadDashboard(userId) {
                    const response = await fetch('/api/user/' + userId);
                    const data = await response.json();

                    if(data.user) {
                        document.getElementById('signup-section').classList.add('hidden');
                        document.getElementById('dashboard-section').classList.remove('hidden');

                        document.getElementById('dash-name').innerText = data.user.name;
                        document.getElementById('dash-wallet').innerText = data.user.wallet_balance;
                        document.getElementById('dash-link').value = window.location.origin + '/ref/' + data.user.referral_code;

                        const listEl = document.getElementById('referral-list');
                        if(data.referrals.length > 0) {
                            listEl.innerHTML = data.referrals.map(r => \`<li>\${r.referee_name} - Earned ₹\${r.reward_amount} (\${r.status})</li>\`).join('');
                        } else {
                            listEl.innerHTML = '<li>No referrals yet. Share your link!</li>';
                        }
                    } else {
                        logout();
                    }
                }

                function logout() {
                    localStorage.removeItem('userId');
                    location.reload();
                }
            </script>
        </body>
        </html>
    `);
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
  
