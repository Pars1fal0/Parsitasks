const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

module.exports = [
  {
    name: "MCP worker advertises protected read and write tools",
    fn() {
      const source = fs.readFileSync(path.resolve(__dirname, "../mcp/worker.mjs"), "utf8");
      const managementSource = fs.readFileSync(path.resolve(__dirname, "../mcp/management-tools.mjs"), "utf8");
      const nutritionSource = fs.readFileSync(path.resolve(__dirname, "../mcp/nutrition-tools.mjs"), "utf8");
      const promptsSource = fs.readFileSync(path.resolve(__dirname, "../mcp/prompts.mjs"), "utf8");
      const toolNames = [...`${source}\n${managementSource}\n${nutritionSource}`.matchAll(/server\.registerTool\(\s*"([^"]+)"/g)]
        .map((match) => match[1]);

      assert.deepEqual(toolNames, [
        "get_today_overview",
        "get_journal_entry",
        "get_journal_period",
        "append_journal_entry",
        "search",
        "fetch",
        "create_task",
        "complete_task",
        "update_task",
        "delete_task",
        "set_habit_value",
        "create_goal",
        "update_goal_checkpoint",
        "get_day_brief",
        "list_mcp_activity",
        "undo_mcp_action",
        "get_calendar_range",
        "get_backlog",
        "get_productivity_stats",
        "list_categories",
        "preview_task_plan",
        "apply_task_plan",
        "create_habit",
        "update_habit",
        "set_habit_active",
        "update_goal",
        "delete_goal",
        "duplicate_task",
        "acknowledge_overdue",
        "upsert_category",
        "delete_category",
        "get_nutrition_week",
        "get_nutrition_day",
        "list_nutrition_foods",
        "list_meal_templates",
        "get_nutrition_targets",
        "get_shopping_list",
        "create_nutrition_meal",
        "update_nutrition_meal",
        "set_nutrition_meal_status",
        "delete_nutrition_meal",
        "upsert_nutrition_food",
        "delete_nutrition_food",
        "upsert_meal_template",
        "delete_meal_template",
        "set_nutrition_targets",
        "set_nutrition_plan_paused",
        "preview_nutrition_plan",
        "apply_nutrition_plan",
        "clear_nutrition_period",
      ]);
      assert.match(source, /securitySchemes:\s*OAUTH_SECURITY/g);
      assert.match(source, /annotations:\s*\{\s*readOnlyHint:\s*true,\s*openWorldHint:\s*false,\s*destructiveHint:\s*false\s*\}/);
      assert.match(source, /annotations:\s*\{\s*readOnlyHint:\s*false,\s*openWorldHint:\s*false,\s*destructiveHint:\s*false\s*\}/);
      assert.match(source, /"delete_task"[\s\S]*confirm:\s*z\.boolean/);
      assert.match(source, /destructiveHint:\s*true/);
      assert.match(source, /SUPABASE_PUBLISHABLE_KEY \|\| env\.SUPABASE_ANON_KEY/);
      assert.match(source, /payload\?\.role === "service_role"/);
      assert.match(source, /\^sb_secret_/);
      assert.match(source, /Access-Control-Allow-Origin": "\*"/);
      assert.match(source, /Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'"/);
      assert.match(source, /methodNotAllowed\(\["GET", "POST", "DELETE"\]\)/);
      assert.match(source, /url\.pathname === "\/"[\s\S]*assetPage\(request, env, "\/landing\.html"\)/);
      assert.match(source, /url\.pathname === "\/app"[\s\S]*assetPage\(request, env, "\/index\.html"\)/);
      assert.match(source, /\["\/auth", "\/auth\.html"\]\.includes\(url\.pathname\)[\s\S]*assetPage\(request, env, "\/auth\.html"\)/);
      assert.deepEqual(
        [...promptsSource.matchAll(/server\.registerPrompt\(\s*"([^"]+)"/g)].map((match) => match[1]),
        ["plan_week", "review_backlog", "monthly_review", "journal_weekly_reflection"],
      );
    },
  },
];
