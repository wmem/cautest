console.log(JSON.stringify({ groups: [{ name: "external-json", cases: [
  { name: "pass", status: "PASS" },
  { name: "behavior", status: "FAIL", failures: [{ message: "expected 1" }] }
] }] }));
process.exitCode = 1;
