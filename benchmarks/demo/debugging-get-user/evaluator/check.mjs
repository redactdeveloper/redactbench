import { getUser } from "/workspace/users.mjs";

const scenario = process.argv[2];

const scenarios = {
  ordered() {
    const users = [
      { id: 0, name: "Ada" },
      { id: 1, name: "Lin" }
    ];
    return getUser(users, 1)?.name === "Lin";
  },
  sparse() {
    const users = [
      { id: 100, name: "Ada" },
      { id: 205, name: "Lin" }
    ];
    return getUser(users, 205)?.name === "Lin";
  },
  missing() {
    const users = [{ id: 100, name: "Ada" }];
    return getUser(users, 999) === undefined;
  },
  empty() {
    return getUser([], 1) === undefined;
  }
};

if (!scenario || !(scenario in scenarios) || !scenarios[scenario]()) {
  console.error(`Scenario failed: ${scenario ?? "missing"}`);
  process.exit(1);
}
