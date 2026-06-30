import { LanguageSwitcher } from "@/components/shell/language-switcher";
import i18n from "@/lib/i18n/config";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

describe("LanguageSwitcher", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
    localStorage.clear();
  });

  it("changes the active i18n language", async () => {
    const user = userEvent.setup();

    render(<LanguageSwitcher />);

    await user.click(screen.getByRole("button", { name: /language/i }));
    await user.click(screen.getByText("Português"));

    await waitFor(() => expect(i18n.resolvedLanguage).toBe("pt"));
  });
});
