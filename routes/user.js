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

// --- STRONG UPGRADE 1: BETTER FUNCTION EXPLANATION ---
const getAdvancedExplanation = (name, type, lineContent) => {
    const n = name.toLowerCase();
    const lc = lineContent.toLowerCase();

    if (lc.includes('async')) return "This is a 'Time-Traveler' function. ⏳ It works in the background (asynchronously), meaning it can talk to servers or databases without freezing the entire application for the user.";
    if (lc.includes('try') && lc.includes('catch')) return "Consider this the 'Safety Net' pattern. 🛡️ If something unexpected happens inside this block, the application won't crash; instead, it gracefully handles the error and keeps running.";
    if (n.includes('render') || n.includes('component')) return "This is a 'Visual Blueprint'. 🎨 It defines exactly what part of the user interface should look like, acting as a modular building block for the whole frontend.";
    if (n.includes('middleware') || n.includes('handler')) return "Think of this as a 'Traffic Filter'. 🚦 It stands between the user's request and the final data, checking for permissions or logging activity along the way.";
    if (n.includes('db') || n.includes('query') || n.includes('model')) return "This is the 'Warehouse Foreman'. 🏗️ It manages the heavy lifting of talking to your database, ensuring that data is stored and retrieved efficiently.";

    // Fallback Education
    return `In this section, you've created a **${type}** named **'${name}'**. It acts as an isolated 'Thinking Unit' that handles a specific logic task, making your project easier to maintain! 👨‍🏫`;
};

// --- STRONG UPGRADE 2: INTELLIGENCE-BASED LANGUAGE DETECTION ---
const detectLanguageSmart = (code, fileName) => {
    const ext = fileName.split('.').pop().toLowerCase();
    const c = code.toLowerCase();

    if (c.includes('import react') || c.includes('from "react"')) return "React (JSX)";
    if (c.includes('require("express")') || c.includes('express()')) return "Express.js (Node)";
    if (c.includes('import tensorflow') || c.includes('import torch')) return "AI/ML (Python)";
    if (c.includes('from flask import')) return "Flask (Python)";
    if (c.includes('import django')) return "Django (Python)";
    if (c.includes('public static void main')) return "Java Standard";
    if (c.includes('cout <<') || c.includes('#include')) return "C++ System";

    // Default Mapping
    const map = { 'js': 'JavaScript', 'py': 'Python', 'java': 'Java', 'html': 'HTML Structure', 'css': 'CSS Styling' };
    return map[ext] || ext.toUpperCase();
};

const analyzeCode = (code, fileName) => {
    const lines = code.split('\n');
    const components = [];
    lines.forEach((line, index) => {
        let match;
        if ((match = line.match(/(?:async\s+)?function\s+(\w+)\s*\(/)) || (match = line.match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=]+)\s*=>/))) {
            components.push({ name: match[1], line: index + 1, explanation: getAdvancedExplanation(match[1], "Function", line) });
        } else if (match = line.match(/(?:async\s+)?def\s+(\w+)\s*\(/)) {
            components.push({ name: match[1], line: index + 1, explanation: getAdvancedExplanation(match[1], "Python Handler", line) });
        } else if (match = line.match(/class\s+(\w+)/)) {
            components.push({ name: match[1], line: index + 1, explanation: getAdvancedExplanation(match[1], "Blueprint/Class", line) });
        }
    });

    return {
        id: Date.now().toString() + "_" + Math.floor(Math.random() * 1000),
        fileName,
        lang: detectLanguageSmart(code, fileName),
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
        let totalL = 0, count = 0, detectedLangs = [];
        for (const f of req.files) {
            if (path.extname(f.originalname).toLowerCase() === '.zip') {
                const z = new AdmZip(f.path);
                z.getEntries().forEach(e => {
                    if (!e.isDirectory && ['.js', '.py', '.java', '.html', '.css'].includes(path.extname(e.entryName).toLowerCase())) {
                        const d = analyzeCode(e.getData().toString('utf8'), e.entryName);
                        totalL += d.lineCount; count++; detectedLangs.push(d.lang);
                        storeDoc(d, req.session.userId, pId);
                    }
                });
            } else {
                const d = analyzeCode(fs.readFileSync(f.path, 'utf8'), f.originalname);
                totalL += d.lineCount; count++; detectedLangs.push(d.lang);
                storeDoc(d, req.session.userId, pId);
            }
        }
        storeProject({ id: pId, userId: req.session.userId, name: req.files[0].originalname, timestamp: new Date().toLocaleString(), lang: Array.from(new Set(detectedLangs)).join(', '), fileCount: count, totalLines: totalL });
        res.redirect(`/project/${pId}`);
    });
});

router.post("/upload-github", checkAuth, async (req, res) => {
    const { githubUrl } = req.body;
    try {
        const pId = Date.now().toString();
        const r = await axios.get(`${githubUrl.replace(/\/$/, "")}/archive/refs/heads/main.zip`, { responseType: 'arraybuffer' });
        const z = new AdmZip(Buffer.from(r.data));
        let totalL = 0, count = 0, detectedLangs = [];
        z.getEntries().forEach(e => {
            if (!e.isDirectory && ['.js', '.py'].includes(path.extname(e.entryName).toLowerCase())) {
                const d = analyzeCode(e.getData().toString('utf8'), e.entryName);
                totalL += d.lineCount; count++; detectedLangs.push(d.lang);
                storeDoc(d, req.session.userId, pId);
            }
        });
        storeProject({ id: pId, userId: req.session.userId, name: githubUrl.split('/').pop(), timestamp: new Date().toLocaleString(), lang: Array.from(new Set(detectedLangs)).join(', '), fileCount: count, totalLines: totalL });
        res.redirect(`/project/${pId}`);
    } catch (e) { res.redirect("/upload?error=github"); }
});

module.exports = router;