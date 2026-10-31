import os
import random
import csv
from pathlib import Path

def generate_100k_csv():
    output_path = Path(__file__).resolve().parent / "large_100k_sample.csv"
    print(f"Generating 100,000 messy rows into {output_path}...")

    names = ["Ada Lovelace", "Grace Hopper", "Alan Turing", "Katherine Johnson", "Linus Torvalds", 
             "Barbara Liskov", "Jean Bartik", "Ken Thompson", "Margaret Hamilton", "Claude Shannon"]
    regions = ["North", "north ", "NORTH", "South", "SOUTH", "south ", "East", "WEST", "west", ""]
    plans = ["Pro", "pro", "Enterprise", "enterprise", "Free", "free", "N/A", ""]
    domains = ["gmail.com", "enterprise.org", "techcorp.io", "company.co"]

    rows = []
    
    # 95,000 unique base rows
    for i in range(95000):
        name = random.choice(names)
        clean_name = name.lower().replace(" ", "")
        
        # Inconsistent email or null
        if i % 17 == 0:
            email = ""
        else:
            email = f"{clean_name}{i % 500}@{random.choice(domains)}"
            
        # Inconsistent phone formats
        raw_digits = f"{random.randint(200,999)}{random.randint(100,999)}{random.randint(1000,9999)}"
        if i % 19 == 0:
            phone = ""
        elif i % 3 == 0:
            phone = f"+1-{raw_digits[:3]}-{raw_digits[3:6]}-{raw_digits[6:]}"
        elif i % 3 == 1:
            phone = f"({raw_digits[:3]}) {raw_digits[3:6]}-{raw_digits[6:]}"
        else:
            phone = raw_digits
            
        # Mixed date formats
        y = random.choice([2024, 2025])
        m = random.randint(1, 12)
        d = random.randint(1, 28)
        if i % 4 == 0:
            date_str = f"{y}-{m:02d}-{d:02d}"
        elif i % 4 == 1:
            date_str = f"{d:02d}/{m:02d}/{y}"
        elif i % 4 == 2:
            date_str = f"{y}/{m:02d}/{d:02d}"
        else:
            date_str = "" # missing
            
        # Outliers & messy currency
        if i % 13 == 0:
            revenue = "" # missing
        elif i % 400 == 0: # Extreme high outlier
            revenue = f"${random.randint(95000, 250000)}"
        elif i % 2 == 0:
            revenue = f"${random.randint(500, 8500)}"
        else:
            revenue = f"{random.randint(500, 8500)}"
            
        region = random.choice(regions)
        plan = random.choice(plans)
        tickets = "" if i % 11 == 0 else str(random.randint(0, 15))
        
        rows.append([name, email, phone, date_str, revenue, region, plan, tickets])

    # Inject 5,000 duplicates to reach exactly 100,000 rows
    duplicate_source = rows[0:5000]
    rows.extend(duplicate_source)

    headers = ["customer_name", "email", "phone_number", "sign_up_date", "monthly_revenue", "region", "plan_type", "support_tickets"]
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(headers)
        writer.writerows(rows)

    print(f"Done! Generated {len(rows):,} rows at {output_path} ({os.path.getsize(output_path) / (1024*1024):.2f} MB)")

if __name__ == "__main__":
    generate_100k_csv()
