const REGIONS = ["North", "north ", "SOUTH", "East", "West", ""];
const PLANS = ["Pro", "pro", "Enterprise", "Free", "enterprise", "n/a"];
const NAMES = [
  "Ada Lovelace",
  "Grace Hopper",
  "Alan Turing",
  " Katherine Johnson ",
  "Linus Torvalds",
  "Barbara Liskov",
  "Jean Bartik",
  "Ken Thompson",
];

export function sampleCsv(): string {
  const header = "Customer Name, Sign-Up Date ,Monthly Revenue,Region,Plan Type,IsActive,Support Tickets";
  const rows: string[] = [];
  for (let i = 0; i < 240; i++) {
    const name = NAMES[i % NAMES.length]!;
    const date = `2025-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 27) + 1).padStart(2, "0")}`;
    const revenue = i % 11 === 0 ? "" : i % 17 === 0 ? "N/A" : `$${500 + ((i * 37) % 9000)}`;
    const region = REGIONS[i % REGIONS.length]!;
    const plan = PLANS[i % PLANS.length]!;
    const active = ["true", "yes", "FALSE", "no", ""][i % 5]!;
    const tickets = i % 13 === 0 ? "" : String(i % 9);
    rows.push([name, date, revenue, region, plan, active, tickets].join(","));
  }
  // inject duplicates
  for (let i = 0; i < 18; i++) rows.push(rows[i * 3]!);
  return [header, ...rows].join("\n");
}

export function sampleFile(): File {
  return new File([sampleCsv()], "messy_customers_sample.csv", { type: "text/csv" });
}
