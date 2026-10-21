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

// Database Setup
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
        wallet_balance REAL DEFAULT 0.0,
        click_count INTEGER DEFAULT 0
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS referral_rewards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        referrer_id INTEGER,
        referee_id INTEGER,
        reward_amount REAL,
        status TEXT DEFAULT 'Pending'
    )`);
});

// Helper: Unique Referral Code Generator
function generateReferralCode(name) {
    const cleanName = name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 3).toUpperCase();
    const randomHex = crypto.randomBytes(2).toString('hex').toUpperCase();
    return cleanName + '-' + randomHex;
}

// ---------------- USER ROUTES & TRACKING ---------------- //

app.get('/ref/:code', (req, res) => {
    const code = req.params.code;
    db.run("UPDATE users SET click_count = click_count + 1 WHERE referral_code = ?", [code], (err) => {
        res.cookie('ref_code', code, { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: true });
        res.redirect('/');
    });
});

app.post('/api/signup', (req, res) => {
    const name = req.body.name;
    const email = req.body.email;
    
    if (!name || !email) {
        return res.status(400).json({ error: "Name and Email are required!" });
    }

    const referralCode = generateReferralCode(name);
    const refCodeFromCookie = req.cookies.ref_code || null;

    db.serialize(() => {
        let findReferrerQuery = "SELECT id, referral_code FROM users WHERE referral_code = ?";
        db.get(findReferrerQuery, [refCodeFromCookie], (err, referrer) => {
            let referredById = referrer ? referrer.id : null;

            let insertUserQuery = "INSERT INTO users (name, email, referral_code, referred_by) VALUES (?, ?, ?, ?)";
            db.run(insertUserQuery, [name, email, referralCode, referredById], function(err) {
                if (err) {
                    return res.status(400).json({ error: "Email already registered or error occurred!" });
                }

                const newUserId = this.lastID;

                if (referredById && referredById !== newUserId) {
                    const rewardAmount = 50.0; 
                    db.run("INSERT INTO referral_rewards (referrer_id, referee_id, reward_amount, status) VALUES (?, ?, ?, ?)", 
                        [referredById, newUserId, rewardAmount, 'Pending']);
                }

                res.json({ 
                    success: true, 
                    userId: newUserId, 
                    name: name, 
                    referralCode: referralCode,
                    referralLink: req.protocol + '://' + req.get('host') + '/ref/' + referralCode
                });
            });
        });
    });
});

app.get('/api/user/:id', (req, res) => {
    const userId = req.params.id;
    db.get("SELECT id, name, email, referral_code, wallet_balance, click_count FROM users WHERE id = ?", [userId], (err, user) => {
        if (!user) return res.status(404).json({ error: "User not found" });

        db.all("SELECT r.referee_id, u.name as referee_name, r.reward_amount, r.status FROM referral_rewards r JOIN users u ON r.referee_id = u.id WHERE r.referrer_id = ?", [userId], (err, referrals) => {
            res.json({ user: user, referrals: referrals });
        });
    });
});

// ---------------- ADMIN MANAGEMENT API ROUTES ---------------- //

app.get('/api/admin/data', (req, res) => {
    db.all("SELECT u.id, u.name, u.email, u.referral_code, u.click_count, u.wallet_balance, (SELECT name FROM users WHERE id = u.referred_by) as referred_by_name FROM users u ORDER BY u.id DESC", [], (err, users) => {
        db.all("SELECT r.id, r.status, r.reward_amount, (SELECT name FROM users WHERE id = r.referrer_id) as referrer_name, (SELECT name FROM users WHERE id = r.referee_id) as referee_name, (SELECT id FROM users WHERE id = r.referrer_id) as referrer_id FROM referral_rewards r ORDER BY r.id DESC", [], (err, rewards) => {
            res.json({ users: users, rewards: rewards });
        });
    });
});

app.post('/api/admin/update-reward', (req, res) => {
    const rewardId = req.body.rewardId;
    const newStatus = req.body.status;

    db.get("SELECT * FROM referral_rewards WHERE id = ?", [rewardId], (err, reward) => {
        if (!reward) return res.status(404).json({ error: "Reward not found" });

        db.run("UPDATE referral_rewards SET status = ? WHERE id = ?", [newStatus, rewardId], function(err) {
            if (newStatus === 'Paid' && reward.status !== 'Paid') {
                db.run("UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?", [reward.reward_amount, reward.referrer_id]);
            }
            res.json({ success: true, message: "Reward status updated successfully!" });
        });
    });
});

// ---------------- FRONTEND UI (USER DASHBOARD) ---------------- //

app.get('/', (req, res) => {
    const html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Referral & Data Management System</title>
            <style>
                body { font-family: Arial, sans-serif; background: #f4f7f6; margin: 0; padding: 20px; color: #333; }
                .container { max-width: 650px; margin: 0 auto; background: #fff; padding: 30px; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.1); }
                h2 { color: #007bff; text-align: center; }
                .form-group { margin-bottom: 15px; }
                label { display: block; margin-bottom: 5px; font-weight: bold; }
                input { width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; }
                button { background: #007bff; color: white; border: none; padding: 10px 15px; width: 100%; border-radius: 4px; font-size: 16px; cursor: pointer; }
                button:hover { background: #0056b3; }
                .card { background: #e9ecef; padding: 15px; border-radius: 6px; margin-top: 20px; }
                .stats-grid { display: flex; gap: 10px; margin-top: 10px; }
                .stat-box { flex: 1; background: #fff; padding: 10px; border-radius: 4px; text-align: center; border: 1px solid #ddd; }
                .hidden { display: none; }
                .admin-link { text-align: center; margin-top: 20px; }
            </style>
        </head>
        <body>
            <div class="container">
                <h2>Referral Management System</h2>
                <div id="signup-section">
                    <p id="ref-notice" style="color: #e83e8c; font-weight: bold; text-align: center;"></p>
                    <div class="form-group">
                        <label>Your Name</label>
                        <input type="text" id="name" placeholder="Enter name">
                    </div>
                    <div class="form-group">
                        <label>Email Address</label>
                        <input type="email" id="email" placeholder="Enter email">
                    </div>
                    <button onclick="registerUser()">Register / Join</button>
                </div>

                <div id="dashboard-section" class="hidden">
                    <div class="card">
                        <h3>Welcome, <span id="dash-name"></span>!</h3>
                        <div class="stats-grid">
                            <div class="stat-box">
                                <small>Link Clicks</small>
                                <h4 id="dash-clicks">0</h4>
                            </div>
                            <div class="stat-box">
                                <small>Wallet Balance</small>
                                <h4 style="color: #28a745;">₹<span id="dash-wallet">0</span></h4>
                            </div>
                        </div>
                        <p style="margin-top: 15px;"><strong>Your Unique Referral Link:</strong></p>
                        <input type="text" id="dash-link" readonly onclick="this.select()">
                        <p style="font-size: 12px; color: #666; margin-top: 5px;">Share this link to earn rewards!</p>
                    </div>
                    
                    <div class="card">
                        <h4>Referral Tracking History</h4>
                        <ul id="referral-list" style="padding-left: 20px; font-size: 14px;">
                            <li>No referrals yet.</li>
                        </ul>
                    </div>
                    <button onclick="logout()" style="background: #dc3545; margin-top: 15px;">Logout / Switch User</button>
                </div>

                <div class="admin-link">
                    <a href="/admin" target="_blank" style="color: #6c757d; text-decoration: none; font-size: 14px;">🔒 Go to Admin Management Panel</a>
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
                        document.getElementById('ref-notice').innerText = "✨ You were invited via referral code: " + refCode;
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
                        body: JSON.stringify({ name: name, email: email })
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
                        document.getElementById('dash-clicks').innerText = data.user.click_count || 0;
                        document.getElementById('dash-wallet').innerText = data.user.wallet_balance;
                        document.getElementById('dash-link').value = window.location.origin + '/ref/' + data.user.referral_code;

                        const listEl = document.getElementById('referral-list');
                        if(data.referrals.length > 0) {
                            let htmlContent = '';
                            for(let i = 0; i < data.referrals.length; i++) {
                                let r = data.referrals[i];
                                htmlContent += '<li><b>' + r.referee_name + '</b> - ₹' + r.reward_amount + ' [<span style="color:blue;">' + r.status + '</span>]</li>';
                            }
                            listEl.innerHTML = htmlContent;
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
    `;
    res.send(html);
});

// ---------------- ADMIN MANAGEMENT PANEL UI ---------------- //

app.get('/admin', (req, res) => {
    const adminHtml = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Admin Data Management Panel</title>
            <style>
                body { font-family: Arial, sans-serif; background: #f8f9fa; margin: 0; padding: 10px; color: #333; }
                .container { max-width: 1100px; margin: 0 auto; background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.1); }
                .header-flex { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #007bff; padding-bottom: 10px; }
                h2 { color: #343a40; margin: 0; font-size: 20px; }
                .back-btn { background: #6c757d; color: white; padding: 6px 12px; text-decoration: none; border-radius: 4px; font-size: 13px; font-weight: bold; }
                .back-btn:hover { background: #5a6268; }
                h3 { margin-top: 25px; color: #007bff; font-size: 16px; }
                .table-responsive { width: 100%; overflow-x: auto; margin-top: 10px; }
                table { width: 100%; border-collapse: collapse; min-width: 700px; }
                th, td { border: 1px solid #dee2e6; padding: 10px; text-align: left; font-size: 13px; white-space: nowrap; }
                th { background-color: #007bff; color: white; }
                tr:nth-child(even) { background-color: #f2f2f2; }
                select { padding: 5px; border-radius: 4px; border: 1px solid #ccc; font-size: 12px; }
                .btn-save { background: #28a745; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; font-size: 12px; }
                .btn-save:hover { background: #218838; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header-flex">
                    <h2>🛠️ Admin Data Management Dashboard</h2>
                    <a href="/" class="back-btn">← Back to App</a>
                </div>

                <h3>Registered Users & Link Clicks Analytics</h3>
                <div class="table-responsive">
                    <table>
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>Name</th>
                                <th>Email</th>
                                <th>Referral Code</th>
                                <th>Total Clicks</th>
                                <th>Referred By</th>
                                <th>Wallet Balance</th>
                            </tr>
                        </thead>
                        <tbody id="users-table">
                            <tr><td colspan="7" style="text-align:center;">Loading users...</td></tr>
                        </tbody>
                    </table>
                </div>

                <h3>Referral Rewards & Payout Management</h3>
                <div class="table-responsive">
                    <table>
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>Referrer</th>
                                <th>Referee</th>
                                <th>Reward</th>
                                <th>Status Action</th>
                            </tr>
                        </thead>
                        <tbody id="rewards-table">
                            <tr><td colspan="5" style="text-align:center;">Loading rewards...</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <script>
                async function fetchAdminData() {
                    const response = await fetch('/api/admin/data');
                    const data = await response.json();

                    const usersEl = document.getElementById('users-table');
                    if(data.users.length > 0) {
                        let usersHtml = '';
                        for(let i = 0; i < data.users.length; i++) {
                            let u = data.users[i];
                            usersHtml += '<tr>' +
                                '<td>' + u.id + '</td>' +
                                '<td>' + u.name + '</td>' +
                                '<td>' + u.email + '</td>' +
                                '<td><code>' + u.referral_code + '</code></td>' +
                                '<td><b style="color: #007bff;">' + u.click_count + ' clicks</b></td>' +
                                '<td>' + (u.referred_by_name || 'Direct Signup') + '</td>' +
                                '<td>₹' + u.wallet_balance + '</td>' +
                            '</tr>';
                        }
                        usersEl.innerHTML = usersHtml;
                    } else {
                        usersEl.innerHTML = '<tr><td colspan="7" style="text-align:center;">No users found.</td></tr>';
                    }

                    const rewardsEl = document.getElementById('rewards-table');
                    if(data.rewards.length > 0) {
                        let rewardsHtml = '';
                        for(let i = 0; i < data.rewards.length; i++) {
                            let r = data.rewards[i];
                            rewardsHtml += '<tr>' +
                                '<td>' + r.id + '</td>' +
                                '<td><strong>' + r.referrer_name + '</strong></td>' +
                                '<td>' + r.referee_name + '</td>' +
                                '<td>₹' + r.reward_amount + '</td>' +
                                '<td>' +
                                    '<select id="status-' + r.id + '">' +
                                        '<option value="Pending" ' + (r.status === 'Pending' ? 'selected' : '') + '>Pending</option>' +
                                        '<option value="Approved" ' + (r.status === 'Approved' ? 'selected' : '') + '>Approved</option>' +
                                        '<option value="Paid" ' + (r.status === 'Paid' ? 'selected' : '') + '>Paid</option>' +
                                        '<option value="Rejected" ' + (r.status === 'Rejected' ? 'selected' : '') + '>Rejected</option>' +
                                    '</select> ' +
                                 
