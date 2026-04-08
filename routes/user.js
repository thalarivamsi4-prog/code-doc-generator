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

// Data Helpers
const getStoredProjects = (userId) => db.prepare("SELECT * FROM projects WHERE userId = ? ORDER BY timestamp DESC").all(userId);
const getProjectDocs = (projectId) => {
    const rows = db.prepare("SELECT * FROM docs WHERE projectId = ?").all(projectId);
    return rows.map(r => ({ ...r, functions: JSON.parse(r.functions), metrics: { lineCount: r.lineCount, componentCount: r.componentCount } }));
};
const storeProject = (p) => db.prepare(`INSERT INTO projects VALUES (?,?,?,?,?,?,?)`).run(p.id, p.userId, p.name, p.timestamp, p.lang, p.fileCount, p.totalLines);
const storeDoc = (d, u, p) => db.prepare(`INSERT INTO docs VALUES (?,?,?,?,?,?,?,?,?,?)`).run(d.id, u, p, d.fileName, d.lang, d.timestamp, JSON.stringify(d.functions), d.rawCode, d.lineCount, d.componentCount);

// --- SMART UPGRADE: TEACHER-STYLE EXPLANATION GENERATOR ---
const getAdvancedExplanation = (name, type, lineContent) => {
    const n = name.toLowerCase();
    const lc = lineContent.toLowerCase();

    if (lc.includes('async')) return "Think of this as a 'Background Tasker'. ⏳ It works in silence without stopping the main application flow.";
    if (lc.includes('try') && lc.includes('catch')) return "This is a 'Safety Barrier'. 🛡️ It catches errors before they can crash your site, ensuring a smooth user experience.";
    if (n.includes('login') || n.includes('auth')) return "This is the 'Gatekeeper'. 🛂 It manages security and verifies who is allowed to enter your vault.";
    if (n.includes('render') || n.includes('view') || n.includes('ui')) return "This is a 'Visual Weaver'. 🎨 It takes data and transforms it into the beautiful interface the user sees.";
    if (n.includes('fetch') || n.includes('api')) return "This is the 'Information Bridge'. 🌉 It carries messages between your app and the outside world.";

    return `In this section, you've created a **${type}** named **'${name}'**. It acts as a specialized unit of thinking that simplifies your project architecture! 👨‍🏫`;
};

// --- SCALABILITY UPGRADE: INTELLIGENCE-BASED CHUNKING ---
const analyzeCodeOptimized = (code, fileName) => {
    const MAX_LINES = 1000;
    const lines = code.split('\n');
    const isLargeFile = lines.length > MAX_LINES;

    // For large files, we prioritize 'Signatures' to stay within token-style limits
    const analysisLines = isLargeFile ? lines.filter(l => l.includes('function') || l.includes('class') || l.includes('=>') || l.includes('def ')) : lines;

    const components = [];
    analysisLines.forEach((line, index) => {
        let match;
        const realLineNum = isLargeFile ? 1 : index + 1; // Simplification for large chunk logic

        if ((match = line.match(/(?:async\s+)?function\s+(\w+)\s*\(/)) || (match = line.match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=]+)\s*=>/))) {
            components.push({ name: match[1], line: realLineNum, explanation: getAdvancedExplanation(match[1], "Function", line) });
        } else if (match = line.match(/(?:async\s+)?def\s+(\w+)\s*\(/)) {
            components.push({ name: match[1], line: realLineNum, explanation: getAdvancedExplanation(match[1], "Process", line) });
        } else if (match = line.match(/class\s+(\w+)/)) {
            components.push({ name: match[1], line: realLineNum, explanation: getAdvancedExplanation(match[1], "Logic Blueprint", line) });
        }
    });

    const ext = fileName.split('.').pop().toLowerCase();
    const detectedLang = code.includes('React') ? 'React Library' : (ext === 'js' ? 'JavaScript' : ext === 'py' ? 'Python' : ext.toUpperCase());

    return {
        id: Date.now().toString() + "_" + Math.floor(Math.random() * 1000),
        fileName,
        lang: detectedLang,
        timestamp: new Date().toLocaleString(),
        functions: components,
        rawCode: code,
        lineCount: lines.length,
        componentCount: components.length
    };
};

const checkAuth = (req, res, next) => req.session.userId ? next() : res.redirect("/login");
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
    else res.render("login", { error: "Invalid credentials." });
});
router.get("/logout", (req, res) => { req.session.destroy(); res.redirect("/"); });
router.get("/", (req, res) => res.render("home", { user: req.session.username }));
router.get("/upload", checkAuth, (req, res) => res.render("upload", { user: req.session.username }));
router.get("/dashboard", checkAuth, (req, res) => res.render("dashboard", { projects: getStoredProjects(req.session.userId), user: req.session.username }));
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
        let totalL = 0, count = 0, langs = [];
        for (const f of req.files) {
            const ext = path.extname(f.originalname).toLowerCase();
            if (ext === '.zip') {
                const z = new AdmZip(f.path);
                z.getEntries().forEach(e => {
                    if (!e.isDirectory && ['.js', '.py', '.java', '.cpp'].includes(path.extname(e.entryName).toLowerCase())) {
                        const d = analyzeCodeOptimized(e.getData().toString('utf8'), e.entryName);
                        totalL += d.lineCount; count++; langs.push(d.lang);
                        storeDoc(d, req.session.userId, pId);
                    }
                });
            } else if (ext === '.png' || ext === '.jpg' || ext === '.svg') {
                const doc = { id: Date.now().toString() + "_" + Math.floor(Math.random() * 1000), fileName: f.originalname, lang: 'Visual Asset', timestamp: new Date().toLocaleString(), functions: [], rawCode: "/uploads/" + f.filename, lineCount: 0, componentCount: 0 };
                storeDoc(doc, req.session.userId, pId); count++;
            } else if (['.js', '.py', '.java', '.html', '.css'].includes(ext)) {
                const d = analyzeCodeOptimized(fs.readFileSync(f.path, 'utf8'), f.originalname);
                totalL += d.lineCount; count++; langs.push(d.lang);
                storeDoc(d, req.session.userId, pId);
            }
        }
        storeProject({ id: pId, userId: req.session.userId, name: req.files[0].originalname, timestamp: new Date().toLocaleString(), lang: [...new Set(langs)].join(', '), fileCount: count, totalLines: totalL });
        res.redirect(`/project/${pId}`);
    });
});

router.post("/upload-github", checkAuth, async (req, res) => {
    const { githubUrl } = req.body;
    try {
        const pId = Date.now().toString();
        const r = await axios.get(`${githubUrl.replace(/\/$/, "")}/archive/refs/heads/main.zip`, { responseType: 'arraybuffer' });
        const z = new AdmZip(Buffer.from(r.data));
        let totalL = 0, count = 0, langs = [];
        z.getEntries().forEach(e => {
            const ext = path.extname(e.entryName).toLowerCase();
            if (!e.isDirectory && ['.js', '.py', '.java', '.cpp'].includes(ext)) {
                const d = analyzeCodeOptimized(e.getData().toString('utf8'), e.entryName);
                totalL += d.lineCount; count++; langs.push(d.lang);
                storeDoc(d, req.session.userId, pId);
            }
        });
        storeProject({ id: pId, userId: req.session.userId, name: githubUrl.split('/').pop(), timestamp: new Date().toLocaleString(), lang: [...new Set(langs)].join(', '), fileCount: count, totalLines: totalL });
        res.redirect(`/project/${pId}`);
    } catch (e) { res.redirect("/upload?error=github"); }
});

module.exports = router;