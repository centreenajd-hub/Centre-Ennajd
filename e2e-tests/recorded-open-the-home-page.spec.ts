// dyad-recording-draft-id: "549da5d9-51ed-4b50-8f60-83827ba614ca" "a0dda12d-82e2-49b7-bd71-b114e9deca3e"
import { test, expect } from "@playwright/test";

test("Open the home page", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL("/");
});
