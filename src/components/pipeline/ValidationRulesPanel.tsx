import { useState, useEffect } from "react";
import { Plus, Trash2, ShieldCheck, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { fetchValidationRules, createValidationRule, deleteValidationRule, type ValidationRuleItem } from "@/lib/api";
import { toast } from "sonner";

export function ValidationRulesPanel() {
  const [rules, setRules] = useState<ValidationRuleItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [colName, setColName] = useState("");
  const [ruleType, setRuleType] = useState("not_null");
  const [ruleVal, setRuleVal] = useState("");

  const loadRules = async () => {
    try {
      const data = await fetchValidationRules();
      setRules(data);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadRules();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!colName.trim()) return;
    setLoading(true);
    try {
      await createValidationRule({
        column_name: colName.trim(),
        rule_type: ruleType,
        rule_value: ruleVal.trim() || undefined,
      });
      setColName("");
      setRuleVal("");
      await loadRules();
      toast.success("Validation rule added");
    } catch (err: any) {
      toast.error(err.message || "Failed to add rule");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteValidationRule(id);
      setRules((prev) => prev.filter((r) => r.id !== id));
      toast.success("Rule removed");
    } catch {
      toast.error("Failed to remove rule");
    }
  };

  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-center gap-2.5 border-b border-border/60 pb-3">
        <ShieldCheck className="h-4 w-4 text-primary" />
        <p className="text-sm font-semibold">Schema Validation Rules</p>
        <span className="rounded-full bg-secondary px-2.5 py-0.5 text-[11px] text-muted-foreground">
          {rules.length} active
        </span>
      </div>

      <form onSubmit={handleAdd} className="mt-4 flex flex-wrap gap-2.5">
        <input
          value={colName}
          onChange={(e) => setColName(e.target.value)}
          placeholder="Column name (e.g. revenue)"
          className="flex-1 min-w-36 rounded-xl border border-border bg-secondary/60 px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-ring"
        />
        <select
          value={ruleType}
          onChange={(e) => setRuleType(e.target.value)}
          className="rounded-xl border border-border bg-secondary/60 px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="not_null">Not Null</option>
          <option value="min">Minimum Value</option>
          <option value="max">Maximum Value</option>
          <option value="range">Range (min-max)</option>
          <option value="regex">Regex Match</option>
        </select>
        {ruleType !== "not_null" && (
          <input
            value={ruleVal}
            onChange={(e) => setRuleVal(e.target.value)}
            placeholder="Value or pattern"
            className="w-32 rounded-xl border border-border bg-secondary/60 px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-ring"
          />
        )}
        <button
          type="submit"
          disabled={loading || !colName.trim()}
          className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-all hover:scale-[1.02] disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Rule
        </button>
      </form>

      <div className="mt-4 space-y-2">
        <AnimatePresence>
          {rules.map((rule) => (
            <motion.div
              key={rule.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className="flex items-center justify-between rounded-xl border border-border/50 bg-secondary/40 px-3.5 py-2 text-xs"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-foreground font-medium">{rule.column_name}</span>
                <span className="rounded bg-primary/10 px-2 py-0.5 text-[10px] text-primary uppercase font-semibold">
                  {rule.rule_type}
                </span>
                {rule.rule_value && (
                  <span className="text-muted-foreground font-mono">({rule.rule_value})</span>
                )}
              </div>
              <button
                onClick={() => handleDelete(rule.id)}
                className="text-muted-foreground transition-colors hover:text-destructive p-1"
                aria-label="Delete rule"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
        {rules.length === 0 && (
          <p className="text-xs text-muted-foreground py-2 text-center">
            No custom rules configured yet. The pipeline uses default schema constraints.
          </p>
        )}
      </div>
    </div>
  );
}
