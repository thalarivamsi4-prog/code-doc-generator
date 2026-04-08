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

// Create Tables
db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        email TEXT
    )
`).run();

db.prepare(`
    CREATE TABLE IF NOT EXISTS docs (
        id TEXT PRIMARY KEY,
        userId INTEGER,
        fileName TEXT,
        lang TEXT,
        timestamp TEXT,
        functions TEXT,
        rawCode TEXT,
        lineCount INTEGER,
        componentCount INTEGER
    )
`).run();

// Auth Middleware
const checkAuth = (req, res, next) => {
    if (req.session.userId) next();
    else res.redirect("/login");
};

// Data Helpers
const getStoredDocs = (userId) => {
    const rows = db.prepare("SELECT * FROM docs WHERE userId = ? ORDER BY timestamp DESC").all(userId);
    return rows.map(row => ({
        ...row,
        functions: JSON.parse(row.functions),
        metrics: { lineCount: row.lineCount, componentCount: row.componentCount }
    }));
};

const storeDoc = (doc, userId) => {
    db.prepare(`
        INSERT INTO docs (id, userId, fileName, lang, timestamp, functions, rawCode, lineCount, componentCount)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(doc.id, userId, doc.fileName, doc.lang, doc.timestamp, JSON.stringify(doc.functions), doc.rawCode, doc.metrics.lineCount, doc.metrics.componentCount);
};

// Analysis Logic
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
    return { id: Date.now().toString() + "_" + Math.floor(Math.random() * 1000), fileName, lang: ext === 'js' ? 'javascript' : ext === 'py' ? 'python' : ext, timestamp: new Date().toLocaleString(), functions: components, rawCode: code, metrics: { lineCount: lines.length, componentCount: components.length } };
};

const upload = multer({
    storage: multer.diskStorage({
        destination: "uploads/",
        filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname)
    }),
    fileFilter: (req, file, cb) => {
        const allowed = ['.js', '.py', '.java', '.cpp', '.html', '.css', '.zip', '.png', '.jpg', '.jpeg', '.gif', '.svg'];
        cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
    },
    limits: { fileSize: 10 * 1024 * 1024 }
});

// --- AUTH ROUTES ---
router.get("/login", (req, res) => res.render("login", { error: null }));
router.get("/register", (req, res) => res.render("register", { error: null }));

router.post("/register", (req, res) => {
    const { username, email, password } = req.body;
    try {
        const hash = bcrypt.hashSync(password, 10);
        db.prepare("INSERT INTO users (username, email, password) VALUES (?, ?, ?)").run(username, email, hash);
        res.redirect("/login");
    } catch (e) { res.render("register", { error: "Username already exists." }); }
});

router.post("/login", (req, res) => {
    const { username, password } = req.body;
    const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
    if (user && bcrypt.compareSync(password, user.password)) {
        req.session.userId = user.id;
        req.session.username = user.username;
        res.redirect("/dashboard");
    } else { res.render("login", { error: "Invalid credentials." }); }
});

router.get("/logout", (req, res) => {
    req.session.destroy();
    res.redirect("/");
});

// --- CORE ROUTES ---
router.get("/", (req, res) => res.render("home", { user: req.session.username }));

router.get("/upload", checkAuth, (req, res) => res.render("upload", { user: req.session.username }));

router.get("/admin", (req, res) => {
    const stats = db.prepare("SELECT COUNT(*) as totalDocs, SUM(lineCount) as totalLines, SUM(componentCount) as totalComponents FROM docs").get();
    res.render("admin", { stats: stats || { totalDocs: 0, totalLines: 0, totalComponents: 0 }, user: req.session.username });
});

router.get("/delete/:id", checkAuth, (req, res) => {
    db.prepare("DELETE FROM docs WHERE id = ? AND userId = ?").run(req.params.id, req.session.userId);
    res.redirect("/dashboard");
});

router.get("/dashboard", checkAuth, (req, res) => res.render("dashboard", { docs: getStoredDocs(req.session.userId), user: req.session.username }));

router.get("/view/:id", checkAuth, (req, res) => {
    const row = db.prepare("SELECT * FROM docs WHERE id = ? AND userId = ?").get(req.params.id, req.session.userId);
    if (row) res.render("result", { result: { ...row, functions: JSON.parse(row.functions), metrics: { lineCount: row.lineCount, componentCount: row.componentCount } }, code: row.rawCode, user: req.session.username });
    else res.redirect("/dashboard");
});

router.get("/download-pdf/:id", checkAuth, (req, res) => {
    const row = db.prepare("SELECT * FROM docs WHERE id = ? AND userId = ?").get(req.params.id, req.session.userId);
    if (!row) return res.redirect("/dashboard");
    const doc = { ...row, functions: JSON.parse(row.functions), metrics: { lineCount: row.lineCount, componentCount: row.componentCount } };
    const pdfPath = path.join(__dirname, `../uploads/doc_${doc.id}.pdf`);
    const pdfDoc = new PDFDocument({ margin: 50 });
    res.setHeader("Content-Type", "application/pdf");
    pdfDoc.pipe(fs.createWriteStream(pdfPath)).on("finish", () => res.download(pdfPath));
    pdfDoc.fillColor("#d97706").fontSize(25).text("CodeDocGen Official Report", { align: "center" }).moveDown();
    pdfDoc.fillColor("#1e293b").fontSize(12).text(`User: ${req.session.username}\nProject: ${doc.fileName}\nCreated: ${doc.timestamp}\nMetrics: ${doc.metrics.lineCount} Lines | ${doc.metrics.componentCount} Units`);
    pdfDoc.moveDown().fillColor("#d97706").fontSize(18).text("Analysis Breakdown").moveDown(0.5);
    doc.functions.forEach(f => {
        pdfDoc.fillColor("#0f172a").fontSize(12).text(f.name, { underline: true });
        pdfDoc.fillColor("#475569").fontSize(10).text(`Line ${f.line}: ${f.explanation}`).moveDown();
    });
    pdfDoc.addPage().fillColor("#d97706").fontSize(18).text("Source Code").moveDown();
    pdfDoc.fillColor("#000000").fontSize(8).font("Courier").text(doc.rawCode);
    pdfDoc.end();
});

router.post("/upload", checkAuth, (req, res) => {
    upload.array("codefile", 20)(req, res, async (err) => {
        if (err || !req.files) return res.redirect("/upload");
        const filesToProcess = [];

        for (const file of req.files) {
            const ext = path.extname(file.originalname).toLowerCase();
            const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.svg'];

            if (ext === '.zip') {
                const zip = new AdmZip(file.path);
                zip.getEntries().forEach(e => {
                    const innerExt = path.extname(e.entryName).toLowerCase();
                    const isCode = ['.js', '.py', '.java', '.cpp', '.html', '.css', '.zip'].includes(innerExt);
                    const isImage = imageExts.includes(innerExt);

                    if (!e.isDirectory && (isCode || isImage)) {
                        filesToProcess.push({
                            name: e.entryName,
                            content: isImage ? null : e.getData().toString('utf8'),
                            type: isImage ? 'image' : 'code'
                        });
                    }
                });
            } else if (imageExts.includes(ext)) {
                filesToProcess.push({
                    name: file.originalname,
                    type: 'image',
                    path: "/uploads/" + file.filename
                });
            } else {
                filesToProcess.push({
                    name: file.originalname,
                    type: 'code',
                    content: fs.readFileSync(file.path, 'utf8')
                });
            }
        }

        for (const f of filesToProcess) {
            if (f.type === 'image') {
                const doc = { id: Date.now().toString() + "_" + Math.floor(Math.random() * 1000), fileName: f.name, lang: 'image', timestamp: new Date().toLocaleString(), functions: [], rawCode: f.path || "Asset in ZIP", metrics: { lineCount: 0, componentCount: 0 } };
                storeDoc(doc, req.session.userId);
            } else {
                const data = analyzeCode(f.content, f.name);
                storeDoc(data, req.session.userId);
            }
        }
        res.redirect("/dashboard");
    });
});

router.post("/upload-github", checkAuth, async (req, res) => {
    const { githubUrl } = req.body;
    try {
        const baseUrl = githubUrl.replace(/\/$/, "");
        const zipUrl = `${baseUrl}/archive/refs/heads/main.zip`;

        const response = await axios.get(zipUrl, { responseType: 'arraybuffer' });
        const zip = new AdmZip(Buffer.from(response.data));
        const entries = zip.getEntries();
        const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.svg'];

        for (const e of entries) {
            const innerExt = path.extname(e.entryName).toLowerCase();
            const isCode = ['.js', '.py', '.java', '.cpp', '.html', '.css', '.zip'].includes(innerExt);
            const isImage = imageExts.includes(innerExt);

            if (!e.isDirectory && (isCode || isImage)) {
                if (isImage) {
                    const doc = { id: Date.now().toString() + "_" + Math.floor(Math.random() * 1000), fileName: e.entryName, lang: 'image', timestamp: new Date().toLocaleString(), functions: [], rawCode: "Asset from GitHub", metrics: { lineCount: 0, componentCount: 0 } };
                    await storeDoc(doc, req.session.userId);
                } else {
                    const content = e.getData().toString('utf8');
                    const data = analyzeCode(content, e.entryName);
                    await storeDoc(data, req.session.userId);
                }
            }
        }
        res.redirect("/dashboard");
    } catch (e) {
        res.redirect("/upload?error=github_failed");
    }
});

module.exports = router;