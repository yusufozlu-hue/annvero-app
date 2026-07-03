import { GIB_QUERY_STATUS } from "./gibQueryStatuses.mjs";

const GIB_LOGIN_URL = "https://dijital.gib.gov.tr/portal/login";
const GIB_ETEBLIGAT_URL = "https://dijital.gib.gov.tr/portal/e-tebligat";

const USER_SELECTORS = [
  'input[name="userid"]',
  'input[id="userid"]',
  'input[placeholder*="Kullanıcı"]',
  'input[type="text"]',
];

const PASSWORD_SELECTORS = [
  'input[name="sifre"]',
  'input[id="sifre"]',
  'input[type="password"]',
];

const PAROLA_SELECTORS = ['input[name="parola"]', 'input[id="parola"]'];

const CAPTCHA_INPUT_SELECTORS = [
  'input[name="captcha"]',
  'input[id="captcha"]',
  'input[placeholder*="Doğrulama"]',
  'input[placeholder*="Guvenlik"]',
  'input[placeholder*="Güvenlik"]',
];

const CAPTCHA_IMAGE_SELECTORS = [
  'img[id*="captcha" i]',
  'img[src*="captcha" i]',
  'img[alt*="captcha" i]',
  'img[alt*="doğrulama" i]',
];

const LOGIN_BUTTON_SELECTORS = [
  'button[type="submit"]',
  'input[type="submit"]',
  'button:has-text("Giriş")',
  'button:has-text("GIRIS")',
];

function isMockMode() {
  return process.env.GIB_AUTOMATION_MOCK === "1";
}

async function findFirstVisible(page, selectors = []) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    const count = await locator.count().catch(() => 0);
    if (!count) continue;

    const visible = await locator.isVisible().catch(() => false);
    if (visible) return locator;
  }

  return null;
}

async function fillFirstVisible(page, selectors, value) {
  const field = await findFirstVisible(page, selectors);
  if (!field) return false;
  await field.fill(String(value || ""));
  return true;
}

export async function launchGibBrowser() {
  if (isMockMode()) {
    return { mock: true };
  }

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    headless: process.env.GIB_PLAYWRIGHT_HEADLESS !== "0",
  });
  const context = await browser.newContext({
    locale: "tr-TR",
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();
  return { browser, context, page, mock: false };
}

export async function closeGibBrowser(bundle) {
  if (!bundle || bundle.mock) return;
  await bundle.context?.close().catch(() => {});
  await bundle.browser?.close().catch(() => {});
}

export async function startGibLoginSession(credentials = {}) {
  if (isMockMode()) {
    return {
      ok: true,
      storageState: { cookies: [], origins: [] },
      captchaImageBase64:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJAD9W2HkAAAAASUVORK5CYII=",
    };
  }

  const bundle = await launchGibBrowser();

  try {
    const { page, context } = bundle;
    await page.goto(GIB_LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60000 });

    const userOk = await fillFirstVisible(page, USER_SELECTORS, credentials.gibUserCode);
    const passOk = await fillFirstVisible(page, PASSWORD_SELECTORS, credentials.password);

    if (!userOk || !passOk) {
      throw new Error("GİB kullanıcı kodu veya şifre alanı bulunamadı.");
    }

    if (credentials.parola) {
      await fillFirstVisible(page, PAROLA_SELECTORS, credentials.parola);
    }

    const captchaImage = await findFirstVisible(page, CAPTCHA_IMAGE_SELECTORS);
    if (!captchaImage) {
      throw new Error("Doğrulama kodu görseli bulunamadı.");
    }

    const screenshot = await captchaImage.screenshot({ type: "png" });
    const storageState = await context.storageState();

    return {
      ok: true,
      storageState,
      captchaImageBase64: `data:image/png;base64,${screenshot.toString("base64")}`,
      bundle,
    };
  } catch (error) {
    await closeGibBrowser(bundle);
    throw error;
  }
}

export async function completeGibLoginAndFetchTebligat({
  storageState,
  verificationCode,
  bundle = null,
}) {
  if (isMockMode()) {
    return {
      ok: true,
      notifications: [
        {
          title: "Mock GİB Tebligat",
          summary: "Test ortamı kaydı",
          reference_no: `MOCK-${Date.now()}`,
          notification_date: new Date().toISOString().slice(0, 10),
        },
      ],
    };
  }

  let localBundle = bundle;
  let shouldClose = false;

  if (localBundle && !localBundle.mock) {
    try {
      const { page } = localBundle;
      const captchaOk = await fillFirstVisible(
        page,
        CAPTCHA_INPUT_SELECTORS,
        verificationCode
      );

      if (!captchaOk) {
        throw new Error("Doğrulama kodu alanı bulunamadı.");
      }

      const loginButton = await findFirstVisible(page, LOGIN_BUTTON_SELECTORS);
      if (!loginButton) {
        throw new Error("Giriş butonu bulunamadı.");
      }

      await Promise.all([
        page.waitForLoadState("domcontentloaded", { timeout: 60000 }).catch(() => {}),
        loginButton.click(),
      ]);

      const currentUrl = page.url();
      if (currentUrl.includes("login")) {
        const bodyText = await page.locator("body").innerText().catch(() => "");
        if (/hatal|yanl|geçersiz|basarisiz|başarısız/i.test(bodyText)) {
          return { ok: false, error: GIB_QUERY_STATUS.LOGIN_ERROR };
        }
      }

      await page.goto(GIB_ETEBLIGAT_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
      const notifications = await scrapeTebligatRows(page);
      return { ok: true, notifications };
    } finally {
      await closeGibBrowser(localBundle);
    }
  }

  if (!localBundle) {
    localBundle = await launchGibBrowser();
    shouldClose = true;
    await localBundle.context.addCookies(storageState?.cookies || []);
  }

  try {
    const { page } = localBundle;
    await page.goto(GIB_LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60000 });

    const captchaOk = await fillFirstVisible(
      page,
      CAPTCHA_INPUT_SELECTORS,
      verificationCode
    );

    if (!captchaOk) {
      throw new Error("Doğrulama kodu alanı bulunamadı.");
    }

    const loginButton = await findFirstVisible(page, LOGIN_BUTTON_SELECTORS);
    if (!loginButton) {
      throw new Error("Giriş butonu bulunamadı.");
    }

    await Promise.all([
      page.waitForLoadState("domcontentloaded", { timeout: 60000 }).catch(() => {}),
      loginButton.click(),
    ]);

    const currentUrl = page.url();
    if (currentUrl.includes("login")) {
      const bodyText = await page.locator("body").innerText().catch(() => "");
      if (/hatal|yanl|geçersiz|basarisiz|başarısız/i.test(bodyText)) {
        return { ok: false, error: GIB_QUERY_STATUS.LOGIN_ERROR };
      }
    }

    await page.goto(GIB_ETEBLIGAT_URL, { waitUntil: "domcontentloaded", timeout: 60000 });

    const notifications = await scrapeTebligatRows(page);
    return { ok: true, notifications };
  } finally {
    if (shouldClose) {
      await closeGibBrowser(localBundle);
    } else if (localBundle) {
      await closeGibBrowser(localBundle);
    }
  }
}

async function scrapeTebligatRows(page) {
  const rows = await page.evaluate(() => {
    const results = [];
    const tableRows = Array.from(document.querySelectorAll("table tbody tr"));

    for (const row of tableRows) {
      const cells = Array.from(row.querySelectorAll("td")).map((cell) =>
        (cell.textContent || "").trim()
      );
      if (cells.length < 2) continue;

      results.push({
        title: cells[1] || cells[0] || "GİB e-Tebligat",
        summary: cells.slice(2).join(" • "),
        reference_no: cells[0] || "",
        notification_date: cells.find((value) => /\d{2}[./-]\d{2}[./-]\d{4}/.test(value)) || "",
      });
    }

    if (results.length) return results;

    const cards = Array.from(
      document.querySelectorAll("[class*='tebligat' i], [class*='notification' i], li")
    );
    for (const card of cards.slice(0, 20)) {
      const text = (card.textContent || "").trim();
      if (text.length < 8) continue;
      results.push({
        title: text.slice(0, 120),
        summary: text,
        reference_no: "",
        notification_date: "",
      });
    }

    return results;
  });

  return (rows || []).filter((row) => row.title);
}
