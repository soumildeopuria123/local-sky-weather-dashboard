/* Local Sky — sign in / create account. Talks only to this project's API. */

const forms = {
  signin: document.getElementById("signin-form"),
  signup: document.getElementById("signup-form"),
};

const tabs = Array.from(document.querySelectorAll(".auth-tab"));
const title = document.getElementById("auth-title");
const lede = document.getElementById("auth-lede");
const foot = document.getElementById("auth-foot");

const signinEmail = document.getElementById("signin-email");
const signinPassword = document.getElementById("signin-password");
const signupPassword = document.getElementById("signup-password");
const signupConfirm = document.getElementById("signup-confirm");
const rememberEmail = document.getElementById("remember-email");
const strength = document.getElementById("password-strength");
const strengthLabel = document.getElementById("strength-label");

const REMEMBER_EMAIL_KEY = "localSkyRememberedEmail";

const COPY = {
  signin: {
    title: "Welcome back.",
    lede: "Sign in to see your cities, their live forecasts and your world map.",
    documentTitle: "Sign in — Local Sky",
  },
  signup: {
    title: "Make the sky yours.",
    lede: "Create an account to keep your cities, units and map pins together on every visit.",
    documentTitle: "Create account — Local Sky",
  },
};

let mode = location.pathname === "/signup" ? "signup" : "signin";

function nextUrl() {
  const value = new URLSearchParams(location.search).get("next");
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/";
  }
  return value;
}

function restoreRememberedEmail() {
  try {
    const saved = localStorage.getItem(REMEMBER_EMAIL_KEY);
    if (!saved) return;
    signinEmail.value = saved;
    rememberEmail.checked = true;
  } catch {
    // Private browsing can block local storage; the form still works.
  }
}

function rememberEmailChoice() {
  try {
    const email = signinEmail.value.trim();
    if (rememberEmail.checked && email) {
      localStorage.setItem(REMEMBER_EMAIL_KEY, email);
    } else {
      localStorage.removeItem(REMEMBER_EMAIL_KEY);
    }
  } catch {
    // Nothing to do if storage is unavailable.
  }
}

function initPasswordToggles() {
  for (const toggle of document.querySelectorAll("[data-password-target]")) {
    const input = document.getElementById(toggle.dataset.passwordTarget);
    if (!input) continue;

    toggle.addEventListener("click", () => {
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      toggle.setAttribute("aria-pressed", String(show));
      const label = show ? "Hide password" : "Show password";
      toggle.setAttribute("aria-label", label);
      toggle.title = label;
      input.focus({ preventScroll: true });
      const end = input.value.length;
      try {
        input.setSelectionRange(end, end);
      } catch {
        // Some input types do not support selection ranges.
      }
    });
  }
}

const capsState = new Map();

function updateCapsNote(input) {
  const note = document.getElementById(
    input.id === "signin-password" ? "signin-caps" : "signup-caps",
  );
  if (!note) return;

  const on =
    typeof input.getModifierState === "function" && input.getModifierState("CapsLock");
  capsState.set(input.id, on);

  const relevant =
    input.id === "signin-password"
      ? ["signin-password"]
      : ["signup-password", "signup-confirm"];
  note.hidden = !relevant.some((id) => capsState.get(id));
}

for (const input of [signinPassword, signupPassword, signupConfirm]) {
  if (!input) continue;
  for (const type of ["keydown", "keyup"]) {
    input.addEventListener(type, () => updateCapsNote(input));
  }
  input.addEventListener("blur", () => {
    capsState.set(input.id, false);
    updateCapsNote(input);
  });
}

const STRENGTH_LABELS = ["", "Too short", "Fair", "Good", "Strong"];

function passwordScore(value) {
  if (!value) return 0;
  if (value.length < 8) return 1;

  let score = 2;
  if (value.length >= 12) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value)) score += 1;
  if (/[^A-Za-z0-9]/.test(value)) score += 1;
  return Math.min(4, score);
}

function updatePasswordStrength() {
  const value = signupPassword.value;
  const score = passwordScore(value);
  strength.hidden = value.length === 0;
  strength.dataset.score = String(score);
  strengthLabel.textContent = value.length === 0 ? "" : STRENGTH_LABELS[score];
}

function setMode(next, { push = true } = {}) {
  mode = next === "signup" ? "signup" : "signin";
  const copy = COPY[mode];

  for (const [key, form] of Object.entries(forms)) {
    form.hidden = key !== mode;
  }

  for (const tab of tabs) {
    tab.setAttribute("aria-selected", String(tab.dataset.mode === mode));
  }

  title.textContent = copy.title;
  lede.textContent = copy.lede;
  document.title = copy.documentTitle;

  foot.innerHTML =
    mode === "signin"
      ? 'New here? <a href="/signup">Create an account</a>.'
      : 'Already have an account? <a href="/signin">Sign in</a>.';

  if (push) {
    const pathname = mode === "signin" ? "/signin" : "/signup";
    history.pushState({ mode }, "", `${pathname}${location.search}`);
  }
}

function showError(element, message) {
  element.textContent = message;
  element.hidden = false;
}

async function submit(form, endpoint, payload, errorElement, busyLabel) {
  const button = form.querySelector('button[type="submit"]');
  const label = button.textContent;

  errorElement.hidden = true;
  button.disabled = true;
  button.textContent = busyLabel;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      showError(
        errorElement,
        data?.error?.message ?? "Something went wrong. Please try again.",
      );
      return;
    }

    const target = nextUrl();
    const destination = data?.inherited
      ? `${target}${target.includes("?") ? "&" : "?"}welcome=1`
      : target;
    location.replace(destination);
  } catch {
    showError(errorElement, "Could not reach the server. Please try again.");
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

for (const tab of tabs) {
  tab.addEventListener("click", (event) => {
    event.preventDefault();
    document.getElementById("signin-error").hidden = true;
    document.getElementById("signup-error").hidden = true;
    setMode(tab.dataset.mode);
  });
}

forms.signin.addEventListener("submit", (event) => {
  event.preventDefault();
  rememberEmailChoice();

  const email = document.getElementById("signin-email").value.trim();
  const password = document.getElementById("signin-password").value;
  const error = document.getElementById("signin-error");

  if (!email || !password) {
    showError(error, "Enter your email and password.");
    return;
  }

  submit(forms.signin, "/api/auth/signin", { email, password }, error, "Signing in…");
});

forms.signup.addEventListener("submit", (event) => {
  event.preventDefault();

  const name = document.getElementById("signup-name").value.trim();
  const email = document.getElementById("signup-email").value.trim();
  const password = document.getElementById("signup-password").value;
  const confirm = document.getElementById("signup-confirm").value;
  const error = document.getElementById("signup-error");

  if (name.length < 2) {
    showError(error, "Enter your name (at least 2 characters).");
    return;
  }
  if (!email || !email.includes("@")) {
    showError(error, "Enter a valid email address.");
    return;
  }
  if (password.length < 8) {
    showError(error, "Use at least 8 characters for your password.");
    return;
  }
  if (password !== confirm) {
    showError(error, "Those passwords do not match.");
    return;
  }

  submit(
    forms.signup,
    "/api/auth/signup",
    { name, email, password },
    error,
    "Creating account…",
  );
});

rememberEmail.addEventListener("change", rememberEmailChoice);
signinEmail.addEventListener("input", () => {
  if (rememberEmail.checked) rememberEmailChoice();
});
signupPassword.addEventListener("input", updatePasswordStrength);

window.addEventListener("popstate", () => {
  const next = location.pathname === "/signup" ? "signup" : "signin";
  setMode(next, { push: false });
});

restoreRememberedEmail();
initPasswordToggles();
updatePasswordStrength();
setMode(mode, { push: false });
