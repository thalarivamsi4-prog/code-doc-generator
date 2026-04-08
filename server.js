const express = require("express");
const path = require("path");
const session = require("express-session");
const userRoutes = require("./routes/user");

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// Session Configuration
app.use(session({
    secret: "codedocgen_secret_key_2026",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// View Engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Routes
app.use("/", userRoutes);

app.listen(PORT, () => {
    console.log(`🚀 CodeDocGen Server running on http://localhost:${PORT}`);
});