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

// --- UPDATED SCHEMA FOR PROJECT GROUPING ---
db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        email TEXT
    )
`).run();

db.prepare(`
    CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        userId INTEGER,
        name TEXT,
        timestamp TEXT,
        lang TEXT,
        fileCount INTEGER,
        totalLines INTEGER
    )
`).run();

db.prepare(`
    CREATE TABLE IF NOT EXISTS docs (
        id TEXT PRIMARY KEY,
        userId INTEGER,
        projectId TEXT,
        fileName TEXT,
        lang TEXT,
        timestamp TEXT,
        functions TEXT,
        rawCode TEXT,
        lineCount INTEGER,
        componentCount INTEGER
    )
`).run();

// Migration: Add projectId if missing
try { db.prepare("ALTER TABLE docs ADD COLUMN projectId TEXT").run(); } catch (e) { }

// Auth Middleware
const checkAuth = (req, res, next) => {
    if (req.session.userId) next();
    else res.redirect("/login");
};

// Data Helpers
const getStoredProjects = (userId) => {
    return db.prepare("SELECT * FROM projects WHERE userId = ? ORDER BY timestamp DESC").all(userId);
};

const getProjectDocs = (projectId) => {
    const rows = db.prepare("SELECT * FROM docs WHERE projectId = ? ORDER BY fileName").all(projectId);
    return rows.map(r => ({ ...r, functions: JSON.parse(r.functions), metrics: { lineCount: r.lineCount, componentCount: r.componentCount } }));
};

const storeProject = (proj) => {
    db.prepare(`INSERT INTO projects (id, userId, name, timestamp, lang, fileCount, totalLines) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(proj.id, proj.userId, proj.name, proj.timestamp, proj.lang, proj.fileCount, proj.totalLines);
};

const storeDoc = (doc, userId, projectId) => {
    db.prepare(`
        INSERT INTO docs (id, userId, projectId, fileName, lang, timestamp, functions, rawCode, lineCount, componentCount)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(doc.id, userId, projectId, doc.fileName, doc.lang, doc.timestamp, JSON.stringify(doc.functions), doc.rawCode, doc.metrics.lineCount, doc.metrics.componentCount);
};

// Analysis Logic (Smart)
const getExplanation = (name, type) => {
    const n = name.toLowerCase();
    if (n.includes('login') || n.includes('auth')) return "Handles security credentials and manages user session authentication logic.";
    if (n.includes('validate') || n.includes('check')) return "Validation logic that ensures data integrity and prevents malformed input.";
    if (n.includes('get') || n.includes('fetch')) return "Data retrieval module designed to bridge the interface with the data store.";
    if (n.includes('save') || n.includes('post') || n.includes('create')) return "Persistence handler responsible for creating new records in storage.";
    return `Detected ${type} '${name}'. Encapsulates specialized logic for project modularity.`;
};

const analyzeCode = (code, fileName) => {
    const lines = code.split('\n');
    const components = [];
    lines.forEach((line, index) => {
        let match;
        if ((match = line.match(/function\s+(\w+)\s*\(/)) || (match = line.match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:\([^)]*\)|[^=]+)\s*=>/))) {
            components.push({ name: match[1], line: index + 1, explanation: getExplanation(match[1], "JS function") });
        } else if (match = line.match(/def\s+(\w+)\s*\(/)) {
            components.push({ name: match[1], line: index + 1, explanation: getExplanation(match[1], "Python function") });
        } else if (match = line.match(/class\s+(\w+)/)) {
            components.push({ name: match[1], line: index + 1, explanation: getExplanation(match[1], "Class") });
        }
    });
    const ext = fileName.split('.').pop().toLowerCase();
    const lang = ext === 'js' ? 'javascript' : ext === 'py' ? 'python' : ext;
    return { id: Date.now().toString() + "_" + Math.floor(Math.random() * 1000), fileName, lang, timestamp: new Date().toLocaleString(), functions: components, rawCode: code, metrics: { lineCount: lines.length, componentCount: components.length } };
};

const upload = multer({ dest: "uploads/", limits: { fileSize: 10 * 1024 * 1024 } });

// --- AUTH & CORE ROUTES ---
router.get("/login", (req, res) => res.render("login", { error: null }));
router.get("/register", (req, res) => res.render("register", { error: null }));
router.post("/register", (req, res) => {
    try { const hash = bcrypt.hashSync(req.body.password, 10); db.prepare("INSERT INTO users (username, email, password) VALUES (?, ?, ?)").run(req.body.username, req.body.email, hash); res.redirect("/login"); }
    catch (e) { res.render("register", { error: "Username taken." }); }
});
router.post("/login", (req, res) => {
    const user = db.prepare("SELECT * FROM users WHERE username = ?").get(req.body.username);
    if (user && bcrypt.compareSync(req.body.password, user.password)) { req.session.userId = user.id; req.session.username = user.username; res.redirect("/dashboard"); }
    else res.render("login", { error: "Invalid credentials." });
});
router.get("/logout", (req, res) => { req.session.destroy(); res.redirect("/"); });
router.get("/", (req, res) => res.render("home", { user: req.session.username }));
router.get("/upload", checkAuth, (req, res) => res.render("upload", { user: req.session.username }));

router.get("/dashboard", checkAuth, (req, res) => {
    res.render("dashboard", { projects: getStoredProjects(req.session.userId), user: req.session.username });
});

router.get("/project/:id", checkAuth, (req, res) => {
    const project = db.prepare("SELECT * FROM projects WHERE id = ? AND userId = ?").get(req.params.id, req.session.userId);
    if (!project) return res.redirect("/dashboard");
    const docs = getProjectDocs(project.id);
    res.render("project_hub", { project, docs, user: req.session.username });
});

router.get("/view/:id", checkAuth, (req, res) => {
    const row = db.prepare("SELECT * FROM docs WHERE id = ? AND userId = ?").get(req.params.id, req.session.userId);
    if (row) res.render("result", { result: { ...row, functions: JSON.parse(row.functions), metrics: { lineCount: row.lineCount, componentCount: row.componentCount } }, code: row.rawCode, user: req.session.username });
    else res.redirect("/dashboard");
});

router.get("/delete-project/:id", checkAuth, (req, res) => {
    db.prepare("DELETE FROM projects WHERE id = ? AND userId = ?").run(req.params.id, req.session.userId);
    db.prepare("DELETE FROM docs WHERE projectId = ? AND userId = ?").run(req.params.id, req.session.userId);
    res.redirect("/dashboard");
});

router.post("/upload", checkAuth, (req, res) => {
    upload.array("codefile", 50)(req, res, async (err) => {
        if (!req.files || req.files.length === 0) return res.redirect("/upload");
        const projectId = Date.now().toString();
        const filesToProcess = [];

        for (const file of req.files) {
            const ext = path.extname(file.originalname).toLowerCase();
            if (ext === '.zip') {
                const zip = new AdmZip(file.path);
                zip.getEntries().forEach(e => {
                    const innerExt = path.extname(e.entryName).toLowerCase();
                    if (!e.isDirectory && ['.js', '.py', '.java', '.cpp', '.html', '.css'].includes(innerExt))
                        filesToProcess.push({ name: e.entryName, content: e.getData().toString('utf8'), type: 'code' });
                });
            } else if (['.png', '.jpg', '.svg'].includes(ext)) {
                filesToProcess.push({ name: file.originalname, type: 'image', path: "/uploads/" + file.filename });
            } else {
                filesToProcess.push({ name: file.originalname, type: 'code', content: fs.readFileSync(file.path, 'utf8') });
            }
        }

        let totalLines = 0;
        for (const f of filesToProcess) {
            if (f.type === 'code') {
                const data = analyzeCode(f.content, f.name);
                totalLines += data.metrics.lineCount;
                storeDoc(data, req.session.userId, projectId);
            } else {
                const doc = { id: Date.now().toString() + "_" + Math.floor(Math.random() * 1000), fileName: f.name, lang: 'image', timestamp: new Date().toLocaleString(), functions: [], rawCode: f.path || "Asset in ZIP", metrics: { lineCount: 0, componentCount: 0 } };
                storeDoc(doc, req.session.userId, projectId);
            }
        }

        storeProject({ id: projectId, userId: req.session.userId, name: req.files[0].originalname, timestamp: new Date().toLocaleString(), lang: filesToProcess[0].lang || 'mixed', fileCount: filesToProcess.length, totalLines });
        res.redirect(`/project/${projectId}`);
    });
});

router.post("/upload-github", checkAuth, async (req, res) => {
    const { githubUrl } = req.body;
    try {
        const projectId = Date.now().toString();
        const response = await axios.get(`${githubUrl.replace(/\/$/, "")}/archive/refs/heads/main.zip`, { responseType: 'arraybuffer' });
        const zip = new AdmZip(Buffer.from(response.data));
        const entries = zip.getEntries();
        let totalLines = 0;
        let count = 0;

        for (const e of entries) {
            const innerExt = path.extname(e.entryName).toLowerCase();
            if (!e.isDirectory && ['.js', '.py', '.java', '.cpp'].includes(innerExt)) {
                const content = e.getData().toString('utf8');
                const data = analyzeCode(content, e.entryName);
                totalLines += data.metrics.lineCount;
                storeDoc(data, req.session.userId, projectId);
                count++;
            }
        }
        storeProject({ id: projectId, userId: req.session.userId, name: githubUrl.split('/').pop(), timestamp: new Date().toLocaleString(), lang: 'GitHub Repo', fileCount: count, totalLines });
        res.redirect(`/project/${projectId}`);
    } catch (e) { res.redirect("/upload?error=github"); }
});

module.exports = router;