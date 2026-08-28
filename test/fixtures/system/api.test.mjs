export default {
  cases: [
    { name: "responds", run() {} },
    { name: "reports-error", run() { throw new Error("expected fixture error"); } },
  ],
};
