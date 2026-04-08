const express = require("express");
const router = express.Router();
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const Database = require("better-sqlite3");
const AdmZip = require("adm-zip");
const bcrypt = require("bcryptjs");
const axios = require("axios");

// Database Initialization (AUTOMATIC)
const DB_PATH = path.join(__dirname, "../storage/docs.db");
const db = new Database(DB_PATH);

// Schema Setup
db.prepare(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, email TEXT)`).run();
db.prepare(`CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, userId INTEGER, name TEXT, timestamp TEXT, lang TEXT, fileCount INTEGER, totalLines INTEGER)`).run();
db.prepare(`CREATE TABLE IF NOT EXISTS docs (id TEXT PRIMARY KEY, userId INTEGER, projectId TEXT, fileName TEXT, lang TEXT, timestamp TEXT, functions TEXT, rawCode TEXT, lineCount INTEGER, componentCount INTEGER)`).run();

// Auth Middleware
const checkAuth = (req, res, next) => {
    if (req.session.userId) next();
    else res.redirect("/login");
};

// Data Helpers
const getStoredProjects = (userId) => db.prepare("SELECT * FROM projects WHERE userId = ? ORDER BY timestamp DESC").all(userId);
const getProjectDocs = (projectId) => {
    const rows = db.prepare("SELECT * FROM docs WHERE projectId = ?").all(projectId);
    return rows.map(r => ({ ...r, functions: JSON.parse(r.functions), metrics: { lineCount: r.lineCount, componentCount: r.componentCount } }));
};
const storeProject = (p) => db.prepare(`INSERT INTO projects VALUES (?,?,?,?,?,?,?)`).run(p.id, p.userId, p.name, p.timestamp, p.lang, p.fileCount, p.totalLines);
const storeDoc = (d, u, p) => db.prepare(`INSERT INTO docs VALUES (?,?,?,?,?,?,?,?,?,?)`).run(d.id, u, p, d.fileName, d.lang, d.timestamp, JSON.stringify(d.functions), d.rawCode, d.lineCount, d.componentCount);

// --- THE TEACHER BRAIN (HEURISTIC AI v2.0) ---
const getTeacherExplanation = (name, type, codeSnippet) => {
    const n = name.toLowerCase();

    // Pattern: Security & Gatekeeping
    if (n.includes('login') || n.includes('auth') || n.includes('session')) {
        return "Think of this as the 'Security Guard' of your application. 🛡️ Its job is to verify who people are before letting them past the front door. It ensures that your private data stays safe from unauthorized visitors.";
    }

    // Pattern: Data Cleaning & Safety
    if (n.includes('validate') || n.includes('check') || n.includes('sanitize')) {
        return "This is your project's 'Quality Control' station. ✅ It inspects incoming data for mistakes or bad intentions, making sure your application doesn't 'choke' on unexpected inputs. It's a hallmark of professional-grade stability.";
    }

    // Pattern: External Communication
    if (n.includes('fetch') || n.includes('api') || n.includes('getdata')) {
        return "This logic acts as a 'Global Messenger.' 🌍 It reaches out across the internet to talk to other computers, bringing back fresh information to power your user interface. It bridges the gap between your server and the outside world.";
    }

    // Pattern: State & Memory
    if (n.includes('set') || n.includes('update') || n.includes('save')) {
        return "This is the 'Memory Record' of your app. 📝 It’s responsible for taking new information—like a user's choice or a new score—and writing it down so the application remembers it even if the page is refreshed.";
    }

    // Pattern: Navigation & Routing
    if (n.includes('route') || n.includes('handle') || n.includes('page')) {
        return "You can view this as the 'Traffic Controller.' 🚦 It listens for user actions (like clicking a button) and decides exactly where the user should go next, ensuring a smooth journey through your application.";
    }

    // Teacher's Educational Context for Generic Code
    return `In this section, your code defines a **${type}** named **'${name}'**. In software engineering, this is a way of 'packaging' a specific task so it can be reused later, much like a recipe in a cookbook. It keeps your project clean and organized! 👨‍🏫`;
};

const analyzeCode = (code, fileName) => {
    const lines = code.split('\n');
    const components = [];
    lines.forEach((line, index) => {
        let match;
        if ((match = line.match(/function\s+(\w+)\s*\(/)) || (match = line.match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:\([^)]*\)|[^=]+)\s*=>/))) {
            components.push({ name: match[1], line: index + 1, explanation: getTeacherExplanation(match[1], "JS function", line) });
        } else if (match = line.match(/def\s+(\w+)\s*\(/)) {
            components.push({ name: match[1], line: index + 1, explanation: getTeacherExplanation(match[1], "Python function", line) });
        } else if (match = line.match(/class\s+(\w+)/)) {
            components.push({ name: match[1], line: index + 1, explanation: getTeacherExplanation(match[1], "Class", line) });
        }
    });
    const ext = fileName.split('.').pop().toLowerCase();
    return { id: Date.now().toString() + "_" + Math.floor(Math.random() * 1000), fileName, lang: ext === 'js' ? 'javascript' : ext === 'py' ? 'python' : ext, timestamp: new Date().toLocaleString(), functions: components, rawCode: code, lineCount: lines.length, componentCount: components.length };
};

const upload = multer({ dest: "uploads/" });

// --- ROUTES ---
router.get("/login", (req, res) => res.render("login", { error: null }));
router.get("/register", (req, res) => res.render("register", { error: null }));
router.post("/register", (req, res) => {
    try { const h = bcrypt.hashSync(req.body.password, 10); db.prepare("INSERT INTO users (username, email, password) VALUES (?, ?, ?)").run(req.body.username, req.body.email, h); res.redirect("/login"); }
    catch (e) { res.render("register", { error: "User exists." }); }
});
router.post("/login", (req, res) => {
    const u = db.prepare("SELECT * FROM users WHERE username = ?").get(req.body.username);
    if (u && bcrypt.compareSync(req.body.password, u.password)) { req.session.userId = u.id; req.session.username = u.username; res.redirect("/dashboard"); }
    else res.render("login", { error: "Invalid login." });
});
router.get("/logout", (req, res) => { req.session.destroy(); res.redirect("/"); });
router.get("/", (req, res) => res.render("home", { user: req.session.username }));
router.get("/upload", checkAuth, (req, res) => res.render("upload", { user: req.session.username }));
router.get("/dashboard", checkAuth, (req, res) => {
    res.render("dashboard", { projects: getStoredProjects(req.session.userId), user: req.session.username });
});
router.get("/project/:id", checkAuth, (req, res) => {
    const p = db.prepare("SELECT * FROM projects WHERE id = ? AND userId = ?").get(req.params.id, req.session.userId);
    if (!p) return res.redirect("/dashboard");
    res.render("project_hub", { project: p, docs: getProjectDocs(p.id), user: req.session.username });
});
router.get("/view/:id", checkAuth, (req, res) => {
    const r = db.prepare("SELECT * FROM docs WHERE id = ? AND userId = ?").get(req.params.id, req.session.userId);
    if (r) res.render("result", { result: { ...r, functions: JSON.parse(r.functions), metrics: { lineCount: r.lineCount, componentCount: r.componentCount } }, code: r.rawCode, user: req.session.username });
    else res.redirect("/dashboard");
});

router.post("/upload", checkAuth, (req, res) => {
    upload.array("codefile", 50)(req, res, async (err) => {
        if (!req.files) return res.redirect("/upload");
        const pId = Date.now().toString();
        let totalL = 0, count = 0;
        for (const f of req.files) {
            const ext = path.extname(f.originalname).toLowerCase();
            if (ext === '.zip') {
                const z = new AdmZip(f.path);
                z.getEntries().forEach(e => {
                    if (!e.isDirectory && ['.js', '.py', '.java'].includes(path.extname(e.entryName).toLowerCase())) {
                        const data = analyzeCode(e.getData().toString('utf8'), e.entryName);
                        totalL += data.lineCount; count++;
                        storeDoc(data, req.session.userId, pId);
                    }
                });
            } else if (['.js', '.py', '.java', '.html', '.css'].includes(ext)) {
                const data = analyzeCode(fs.readFileSync(f.path, 'utf8'), f.originalname);
                totalL += data.lineCount; count++;
                storeDoc(data, req.session.userId, pId);
            }
        }
        storeProject({ id: pId, userId: req.session.userId, name: req.files[0].originalname, timestamp: new Date().toLocaleString(), lang: 'Integrated Hub', fileCount: count, totalLines: totalL });
        res.redirect(`/project/${pId}`);
    });
});

router.post("/upload-github", checkAuth, async (req, res) => {
    const { githubUrl } = req.body;
    try {
        const pId = Date.now().toString();
        const r = await axios.get(`${githubUrl.replace(/\/$/, "")}/archive/refs/heads/main.zip`, { responseType: 'arraybuffer' });
        const z = new AdmZip(Buffer.from(r.data));
        let totalL = 0, count = 0;
        z.getEntries().forEach(e => {
            if (!e.isDirectory && ['.js', '.py'].includes(path.extname(e.entryName).toLowerCase())) {
                const data = analyzeCode(e.getData().toString('utf8'), e.entryName);
                totalL += data.lineCount; count++;
                storeDoc(data, req.session.userId, pId);
            }
        });
        storeProject({ id: pId, userId: req.session.userId, name: githubUrl.split('/').pop(), timestamp: new Date().toLocaleString(), lang: 'GitHub Repository', fileCount: count, totalLines: totalL });
        res.redirect(`/project/${pId}`);
    } catch (e) { res.redirect("/upload?error=github"); }
});

module.exports = router;