require("dotenv").config();
const express = require("express");
const session = require("express-session");
const path = require("path");

const app = express();

// Config
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use(session({
    secret: "ai-mentor-secret",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Route Handlers
const userRoutes = require("./routes/user");
app.use("/", userRoutes);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`\n🚀 CodeDocGen AI Mentor running on http://localhost:${PORT}`);
    console.log(`🛠️ Mode: Intelligent Documentation Analysis\n`);
});