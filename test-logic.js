/**
 * Automated Test Suite for CodeDocGen Logic
 * This script verifies if the analysis engine correctly identifies different structures.
 */

const { analyzeCode } = require('./routes/user'); // Export the function if not already

// Mock data
const jsCode = `
function calculateTotal(price, tax) {
    return price + tax;
}

const greetUser = (name) => {
    console.log("Hello " + name);
};

class UserSession {
    constructor() {}
}
`;

const pythonCode = `
def process_data(data):
    return data.upper()

class DataModel:
    pass
`;

console.log("🚀 Starting CodeDocGen Technical Tests...\n");

// TEST 1: JavaScript Analysis
console.log("Test 1: JavaScript Component Detection");
const jsResult = analyzeCode(jsCode, "test.js");
const jsCount = jsResult.metrics.componentCount;
if (jsCount === 3) {
    console.log("✅ PASS: Found 3 components in JS file.");
} else {
    console.log("❌ FAIL: Found " + jsCount + " components, expected 3.");
}

// TEST 2: Python Analysis
console.log("\nTest 2: Python Component Detection");
const pyResult = analyzeCode(pythonCode, "script.py");
const pyCount = pyResult.metrics.componentCount;
if (pyCount === 2) {
    console.log("✅ PASS: Found 2 components in Python file.");
} else {
    console.log("❌ FAIL: Found " + pyCount + " components, expected 2.");
}

// TEST 3: Metrics Accuracy
console.log("\nTest 3: Line Counting Accuracy");
if (jsResult.metrics.lineCount === jsCode.split('\n').length) {
    console.log("✅ PASS: Line count metric is accurate.");
} else {
    console.log("❌ FAIL: Line count mismatch.");
}

console.log("\n--- Testing Complete ---");
