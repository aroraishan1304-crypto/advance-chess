const state = {
  me: null,
  guest: null,
  ratings: [],
  ratingHistory: {},
  puzzle: null,
  stats: null,
  settings: null,
  friends: [],
  incomingRequests: [],
  outgoingRequests: [],
  challenges: [],
  notifications: [],
  badges: [],
  tournaments: [],
  csrf: null,
  booted: false,
  gamesPage: 1,
  gamesCategory: "all",
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function toast(message, tone = "normal") {
  const el = $("#toast");
  el.textContent = message;
  el.dataset.tone = tone;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 3200);
}

function readCookie(name) {
  const part = document.cookie.split("; ").find(v => v.startsWith(`${name}=`));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : "";
}

function csrf() {
  return state.csrf || readCookie("__Host-ac_csrf");
}

async function api(path, options = {}) {
  const opts = { ...options, headers: { ...(options.headers || {}) } };

  if (
    opts.body &&
    !(opts.body instanceof FormData) &&
    typeof opts.body !== "string"
  ) {
    opts.headers["content-type"] = "application/json";
    opts.body = JSON.stringify(opts.body);
  }

  const method = (opts.method || "GET").toUpperCase();

  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const token = csrf();
    if (token) opts.headers["X-CSRF-Token"] = token;
  }

  const res = await fetch(`/api/account${path}`, opts);

  let data = {};
  try {
    data = await res.json();
  } catch {}

  if (data.csrfToken) state.csrf = data.csrfToken;

  if (!res.ok) {
    const error = new Error(
      data.error || data.message || `request_failed_${res.status}`
    );
    error.status = res.status;
    throw error;
  }

  return data;
}

function humanizeError(error) {
  const code = String(error?.message || error || "request_failed");
  const messages = {
    invalid_credentials: "The credentials were not accepted.",
    invalid_2fa_code: "That verification code is invalid or has already been used.",
    rate_limited: "Too many attempts. Please try again later.",
    csrf_failed: "This request expired. Refresh the page and try again.",
    origin_rejected: "This request was rejected by the security policy.",
    fetch_metadata_rejected: "This request was rejected by the security policy.",
    guest_not_found: "No active guest progress was found.",
    migration_unavailable: "Guest progress is no longer available for migration.",
    user_not_found: "That player could not be found.",
    blocked: "This action is unavailable for that player.",
    profile_private: "This profile is private.",
    profile_unavailable: "This profile is unavailable.",
    username_taken: "That username is already taken.",
    username_or_email_taken: "That username or email is already in use.",
    invalid_username: "That username is not valid.",
    invalid_password: "Choose a stronger password that meets the account requirements.",
    confirmation_required: "Please enter the requested confirmation exactly.",
    challenge_expired: "That challenge has expired.",
    challenge_not_found: "That challenge could not be found.",
    friend_request_not_found: "That friend request is no longer available.",
    friend_requests_disabled: "That player is not accepting friend requests from you.",
    challenges_disabled: "That player is not accepting challenges from you.",
    account_locked: "This account is temporarily locked. Please try again later.",
    email_not_configured: "Account email is not configured on this server.",
    email_delivery_failed: "The email could not be sent. Please try again later.",
    invalid_verification_token: "That verification link is invalid or expired.",
    google_onboarding_expired: "The Google signup session expired. Please start again.",
    google_email_exists_sign_in_and_link: "That email is already linked to an account. Sign in and link Google from Security.",
    avatar_not_found: "That avatar is no longer available.",
    invalid_avatar: "Please choose a valid JPEG, PNG, or WebP image.",
  };
  if (messages[code]) return messages[code];
  if (/^HTTP \d+$/.test(code)) return "The server returned an unexpected response.";
  return code.replaceAll("_", " ").replace(/\b\w/g, ch => ch.toUpperCase()).slice(0, 180);
}

function badgeLabel(code) {
  const labels = {
    games_100: "100 games",
    wins_10: "10 wins",
    wins_50: "50 wins",
    puzzle_100: "100 puzzles",
    puzzle_streak_10: "10 puzzle streak",
  };
  const value = String(code || "");
  return labels[value] || value.replaceAll("_", " ").replace(/\b\w/g, ch => ch.toUpperCase());
}

async function refreshData() {
  const me = await api("/me");
  state.csrf = me.csrfToken || me.guestCsrfToken || state.csrf;
  state.me = me.authenticated ? me.user : null;
  state.guest = me.guest ? me.guestProfile : null;

  if (!state.me) {
    state.ratings = [];
    state.ratingHistory = {};
    state.puzzle = null;
    state.stats = null;
    state.settings = null;
    state.friends = [];
    state.incomingRequests = [];
    state.outgoingRequests = [];
    state.challenges = [];
    state.notifications = [];
    state.badges = [];
    state.tournaments = [];
    return me;
  }

  const [ratings, stats, puzzles, settings, friends, challenges, notifications, badges, tournaments] = await Promise.all([
    api("/ratings"),
    api("/stats"),
    api("/puzzles"),
    api("/settings"),
    api("/friends"),
    api("/challenges"),
    api("/notifications"),
    api("/badges"),
    api("/tournaments"),
  ]);

  state.ratings = ratings.ratings || [];
  state.ratingHistory = ratings.history || {};
  state.puzzle = puzzles.stats || null;
  state.stats = stats || null;
  state.settings = settings.settings || {};
  state.friends = friends.friends || [];
  state.incomingRequests = friends.incomingRequests || [];
  state.outgoingRequests = friends.outgoingRequests || [];
  state.challenges = challenges.challenges || [];
  state.notifications = notifications.notifications || [];
  state.badges = badges.badges || [];
  state.tournaments = tournaments.tournaments || [];

  return me;
}

function renderRoute() {
  if (!state.me) {
    if (state.guest) {
      renderGuest();
    } else {
      showAuth();
      clearContent();
    }
    return;
  }

  showAccount();
  renderSide();

  const raw = location.hash.replace(/^#/, "");
  const [routeRaw, queryRaw] = raw.split("?");
  const route = routeRaw || "profile";

  if (route === "player") {
    const params = new URLSearchParams(queryRaw || "");
    const username = params.get("username") || "";
    if (username) return renderPlayerProfile(username);
  }

  const renderers = {
    profile: renderProfile,
    games: renderGames,
    friends: renderFriends,
    stats: renderStats,
    leaderboard: renderLeaderboard,
    tournaments: renderTournaments,
    settings: renderSettings,
    security: renderSecurity,
    notifications: renderNotifications,
  };

  (renderers[route] || renderProfile)();
}

function openDelete() {
  const m = $("#modal");
  m.replaceChildren();
  m.hidden = false;

  const card = h("section", { class: "modal-card" });
  const form = h("form");
  const username = h("input", { autocomplete: "username", required: true, placeholder: state.me?.username || "Username" });
  const password = h("input", { type: "password", autocomplete: "current-password", placeholder: "Password (when enabled)" });
  const twoFactor = h("input", { inputmode: "numeric", autocomplete: "one-time-code", maxlength: "8", placeholder: "2FA code (when enabled)" });
  const confirm = h("input", { type: "checkbox" });
  const error = h("p", { class: "form-error" });
  const cancel = h("button", { type: "button", class: "secondary-btn", text: "Cancel" });
  const submit = h("button", { type: "submit", class: "danger-btn", text: "Delete account" });

  card.append(
    h("div", { class: "card-head" }, [h("h3", { text: "Delete account" })]),
    h("p", { class: "muted", text: "This permanently removes your account data. The action cannot be undone." }),
    h("label", { class: "field" }, ["Username confirmation", username]),
    h("label", { class: "field" }, ["Password", password]),
    h("label", { class: "field" }, ["2FA code", twoFactor]),
    h("label", { class: "check-row" }, [confirm, " I understand this is permanent."]),
    error,
    h("div", { class: "chips" }, [cancel, submit])
  );
  m.append(card);

  cancel.onclick = () => { m.hidden = true; };
  form.append(...card.querySelectorAll(".field, .check-row"), error, card.querySelector(".chips"));
  card.replaceChildren(
    h("div", { class: "card-head" }, [h("h3", { text: "Delete account" })]),
    h("p", { class: "muted", text: "This permanently removes your account data. The action cannot be undone." }),
    form
  );

  form.onsubmit = async e => {
    e.preventDefault();
    error.textContent = "";
    if (!confirm.checked) { error.textContent = "Please confirm the permanent deletion."; return; }
    submit.disabled = true;
    try {
      await api("/delete", { method: "POST", body: { username: username.value, password: password.value, twoFactorCode: twoFactor.value } });
      m.hidden = true;
      state.me = null;
      state.guest = null;
      state.csrf = null;
      toast("Account deleted.", "success");
      showAuth();
      location.hash = "";
    } catch (e) {
      error.textContent = humanizeError(e);
      submit.disabled = false;
    }
  };
}

async function blockUser(userId, username) {
  if (!confirm(`Block @${username}? This will also cancel pending social interactions.`)) return;
  try {
    await api("/block", { method: "POST", body: { userId } });
    toast(`@${username} blocked.`, "success");
    await refreshData();
    location.hash = "#friends";
    renderRoute();
  } catch (e) {
    toast(humanizeError(e), "error");
  }
}

async function reportUser(userId, username) {
  const details = prompt(`Report @${username}. Briefly describe the issue:` , "");
  if (details === null) return;
  try {
    await api("/report", { method: "POST", body: { userId, category: "other", details } });
    toast("Report submitted.", "success");
  } catch (e) {
    toast(humanizeError(e), "error");
  }
}

function escapeText(value) {
  return String(value ?? "");
}

function safeDate(ms) {
  try {
    return new Date(ms).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

function safeDateTime(ms) {
  try {
    return new Date(ms).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return "";
  }
}

function formatRating(value) {
  return value == null ? "—" : Number(value).toLocaleString();
}

function formatDelta(value) {
  const n = Number(value) || 0;
  return `${n > 0 ? "+" : ""}${n}`;
}

function avatarUrl(user) {
  return user?.avatarUrl || "/account/default-avatar.svg";
}

async function prepareAvatarFile(file) {
  if (
    file.size <= 450 * 1024 &&
    ["image/jpeg", "image/png", "image/webp"].includes(file.type)
  ) {
    return file;
  }

  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("invalid_avatar");
  }

  const bitmap = await createImageBitmap(file);
  const max = 256;
  const scale = Math.min(
    1,
    max / Math.max(bitmap.width, bitmap.height)
  );

  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h2 = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h2;

  const ctx = canvas.getContext("2d", { alpha: false });

  if (!ctx) throw new Error("invalid_avatar");

  ctx.fillStyle = "#111820";
  ctx.fillRect(0, 0, w, h2);
  ctx.drawImage(bitmap, 0, 0, w, h2);
  bitmap.close?.();

  const blob = await new Promise(resolve =>
    canvas.toBlob(resolve, "image/jpeg", 0.82)
  );

  if (!blob || blob.size > 512 * 1024) {
    throw new Error("invalid_avatar");
  }

  return new File([blob], "avatar.jpg", {
    type: "image/jpeg",
  });
}

function userAvatar(user, className = "") {
  const img = document.createElement("img");
  img.className = className;
  img.alt = `${user?.username || "Player"} avatar`;
  img.src = avatarUrl(user);
  img.loading = "lazy";
  img.referrerPolicy = "no-referrer";
  img.onerror = () => {
    img.onerror = null;
    img.src = "/account/default-avatar.svg";
  };
  return img;
}

function h(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") {
      e.className = value;
    } else if (key === "text") {
      e.textContent = value;
    } else if (
      key.startsWith("on") &&
      typeof value === "function"
    ) {
      e.addEventListener(
        key.slice(2).toLowerCase(),
        value
      );
    } else if (
      value !== undefined &&
      value !== null
    ) {
      e.setAttribute(key, value);
    }
  }

  for (const child of children) {
    e.append(
      child instanceof Node
        ? child
        : document.createTextNode(String(child))
    );
  }

  return e;
}

function clearContent() {
  $("#content").replaceChildren();
}

function setView(view) {
  const views = {
    auth: $("#authView"),
    account: $("#accountView"),
    guest: $("#guestView"),
  };

  Object.values(views).forEach((el) => {
    el.hidden = true;
  });

  if (views[view]) {
    views[view].hidden = false;
  }
}

function showAuth() {
  setView("auth");
}

function showAccount() {
  setView("account");
}

function showGuest() {
  setView("guest");
}

function setAuthMode(mode) {
  const selected = mode === "signup" ? "signup" : "login";

  $$("[data-auth-tab]").forEach(button =>
    button.classList.toggle(
      "active",
      button.dataset.authTab === selected
    )
  );

  $("#loginPane").classList.toggle(
    "active",
    selected === "login"
  );

  $("#signupPane").classList.toggle(
    "active",
    selected === "signup"
  );
}

function pageHead(title, subtitle = "", actions = []) {
  const wrap = h("div", { class: "page-head" });

  wrap.append(
    h("div", {}, [
      h("h1", { text: title }),
      h("p", { text: subtitle }),
    ])
  );

  if (actions.length) {
    wrap.append(
      h("div", { class: "page-head-actions" }, actions)
    );
  }

  return wrap;
}

function sectionCard(
  title,
  content,
  className = "card"
) {
  const card = h("section", {
    class: className,
  });

  card.append(
    h("div", { class: "card-head" }, [
      h("h3", { text: title }),
    ]),
    content
  );

  return card;
}

function ratingCard(r) {
  const title =
    r.category.charAt(0).toUpperCase() +
    r.category.slice(1);

  const change =
    r.delta == null ? "" : formatDelta(r.delta);

  const c = h("div", {
    class: "rating-card",
  });

  c.append(
    h("div", {
      class: "label",
      text: title,
    }),
    h("strong", {
      text: formatRating(r.rating),
    }),
    h("span", {
      class:
        r.games < 30
          ? "rating-status provisional"
          : "rating-status",
      text:
        r.games < 30
          ? "Provisional"
          : "Rated",
    })
  );

  if (change) {
    c.append(
      h("em", {
        class:
          Number(r.delta) >= 0
            ? "positive"
            : "negative",
        text: change,
      })
    );
  }

  return c;
}

function presenceFor(user) {
  if (!user?.onlineVisibility) {
    return "Status hidden";
  }

  const last = Number(user.lastSeenAt || 0);

  if (!last) return "Offline";

  return Date.now() - last < 120000
    ? "Online"
    : `Last seen ${safeDateTime(last)}`;
}

function renderSide() {
  const wrap = $("#sideProfile");
  wrap.replaceChildren();

  if (!state.me) return;

  const p = h("div", {
    class: "side-user",
  });

  p.append(
    userAvatar(state.me, "side-avatar")
  );

  const text = h("div", {}, [
    h("strong", {
      text: state.me.username,
    }),
    h("small", {
      text:
        state.me.email ||
        "Player account",
    }),
  ]);

  p.append(text);
  wrap.append(p);

  const current =
    location.hash
      .replace(/^#/, "")
      .split("?")[0] ||
    "profile";

  $$("[data-route]").forEach(link =>
    link.classList.toggle(
      "active",
      link.dataset.route === current
    )
  );

  $("#profileMenuBtn").hidden = false;
  $("#topUsername").textContent =
    state.me.username;
  $("#topAvatar").src =
    avatarUrl(state.me);
}

function renderGuest() {
  showGuest();

  const root = $("#guestContent");
  const data = state.guest?.data || {};
  const username =
    state.guest?.username ||
    state.guest?.label ||
    "Guest";

  const games = Array.isArray(data.games)
    ? data.games
    : [];

  const ratings = data.ratings || {};
  const puzzle = data.puzzles || {};

  const raw =
    location.hash
      .replace(/^#/, "")
      .split("?")[0] ||
    "profile";

  const route = [
    "profile",
    "games",
    "stats",
    "settings",
  ].includes(raw)
    ? raw
    : "profile";

  const nav = h("div", {
    class: "guest-tabs",
  });

  for (const [key, label] of [
    ["profile", "Profile"],
    ["games", "Game history"],
    ["stats", "Stats"],
    ["settings", "Settings"],
  ]) {
    const a = h("a", {
      class: `guest-tab ${
        route === key ? "active" : ""
      }`,
      href: `#${key}`,
      text: label,
    });

    nav.append(a);
  }

  const hero = h("section", {
    class: "card guest-hero",
  });

  const avatar = h("img", {
    class: "guest-big-avatar",
    src: "/account/default-avatar.svg",
    alt: `${username} avatar`,
  });

  const info = h("div");

  info.append(
    h("div", {
      class: "eyebrow",
      text: "GUEST PLAYER",
    }),
    h("h2", {
      text: username,
    }),
    h("p", {
      class: "muted",
      text:
        "This guest identity is already active. You can keep playing immediately without filling out a name form.",
    })
  );

  const actions = h("div", {
    class: "chips",
  }, [
    h("a", {
      class: "primary-btn",
      href: "#create-account",
      text: "Create account",
    }),
    h("a", {
      class: "secondary-btn",
      href: "/chess.html",
      text: "Play chess",
    }),
    h("a", {
      class: "secondary-btn",
      href: "#sign-in",
      text: "Sign in",
    }),
  ]);

  info.append(actions);
  hero.append(avatar, info);

  root.replaceChildren(
    pageHead(
      "Your chess identity",
      "Guest mode is ready. Your guest username stays attached to this browser session."
    ),
    nav,
    hero
  );

  if (route === "profile") {
    root.append(
      h("section", {
        class: "grid grid-3",
      }, [
        h("div", {
          class: "card metric-card",
        }, [
          h("div", {
            class: "metric",
            text: String(games.length),
          }),
          h("div", {
            class: "metric-label",
            text: "Games recorded",
          }),
        ]),

        h("div", {
          class: "card metric-card",
        }, [
          h("div", {
            class: "metric",
            text: String(
              puzzle.solves || 0
            ),
          }),
          h("div", {
            class: "metric-label",
            text: "Puzzles solved",
          }),
        ]),

        h("div", {
          class: "card metric-card",
        }, [
          h("div", {
            class: "metric",
            text: "Guest",
          }),
          h("div", {
            class: "metric-label",
            text: "Account status",
          }),
        ]),
      ])
    );
  } else if (route === "games") {
    const card = h("section", {
      class: "card",
    });

    card.append(
      h("div", {
        class: "card-head",
      }, [
        h("h3", {
          text: "Game history",
        }),
        h("span", {
          class: "muted",
          text: `${games.length} recorded`,
        }),
      ])
    );

    const list = h("div", {
      class: "list",
    });

    games
      .slice(0, 50)
      .forEach(g =>
        list.append(
          h("div", {
            class: "list-row",
          }, [
            h("div", {}, [
              h("strong", {
                text:
                  g.result || "Game",
              }),
              h("small", {
                text:
                  g.timeControl ||
                  "Chess game",
              }),
            ]),
            h("time", {
              text: safeDateTime(
                g.endedAt ||
                  g.createdAt
              ),
            }),
          ])
        )
      );

    if (!games.length) {
      list.append(
        h("div", {
          class: "empty",
          text:
            "No guest games have been recorded yet.",
        })
      );
    }

    card.append(list);
    root.append(card);
  } else if (route === "stats") {
    const card = h("section", {
      class: "card",
    });

    card.append(
      h("div", {
        class: "card-head",
      }, [
        h("h3", {
          text: "Guest statistics",
        }),
      ])
    );

    const grid = h("div", {
      class: "rating-grid",
    });

    for (const key of [
      "bullet",
      "blitz",
      "rapid",
      "classical",
    ]) {
      const r = ratings[key] || {};

      grid.append(
        h("div", {
          class: "rating-card",
        }, [
          h("div", {
            class: "label",
            text: key,
          }),
          h("strong", {
            text: formatRating(
              r.rating ?? 1200
            ),
          }),
          h("span", {
            class: "rating-status",
            text: `${Number(
              r.games || 0
            )} games`,
          }),
        ])
      );
    }

    card.append(
      grid,
      h("p", {
        class: "muted",
        text:
          `Puzzle rating ${formatRating(
            puzzle.rating ?? 1200
          )} · ${Number(
            puzzle.games || 0
          )} attempts · ${Number(
            puzzle.solves || 0
          )} solved`,
      })
    );

    root.append(card);
  } else {
    const card = h("section", {
      class: "card",
    });

    card.append(
      h("div", {
        class: "card-head",
      }, [
        h("h3", {
          text: "Guest settings",
        }),
      ]),
      h("p", {
        class: "muted",
        text:
          "Guest preferences use the chess page settings. A registered account can sync preferences across devices.",
      }),
      h("div", {
        class: "chips",
      }, [
        h("a", {
          class: "secondary-btn",
          href: "/chess.html",
          text: "Open chess settings",
        }),
      ])
    );

    root.append(card);
  }

  $$('a[href="#create-account"]', root)
    .forEach(a =>
      a.addEventListener("click", e => {
        e.preventDefault();
        location.hash =
          "#create-account";
        showAuth();
        setAuthMode("signup");
      })
    );

  $$('a[href="#sign-in"]', root)
    .forEach(a =>
      a.addEventListener("click", e => {
        e.preventDefault();
        location.hash = "";
        showAuth();
        setAuthMode("login");
      })
    );
}

function renderProfile() {
  clearContent();

  const root = $("#content");

  const actions = [
    h("a", {
      class: "secondary-btn",
      href: "/chess.html",
      text: "Play chess",
    }),
  ];

  root.append(
    pageHead(
      "Your profile",
      "Your chess identity, ratings and progress.",
      actions
    )
  );

  const hero = h("section", {
    class: "card profile-hero",
  });

  const avatarBox = h("div", {
    class: "profile-avatar-wrap",
  });

  avatarBox.append(
    userAvatar(
      state.me,
      "profile-avatar"
    )
  );

  hero.append(avatarBox);

  const identity = h("div", {
    class: "profile-identity",
  });

  identity.append(
    h("h2", {
      text:
        state.me.displayName ||
        state.me.username,
    }),
    h("div", {
      class: "handle",
      text: `@${state.me.username}`,
    }),
    h("p", {
      class: "profile-about",
      text:
        state.me.about ||
        "No public bio yet.",
    })
  );

  const badges =
    state.badges.slice(0, 4);

  if (badges.length) {
    identity.append(
      h("div", {
        class: "badge-row",
      },
        badges.map(b =>
          h("span", {
            class: "badge",
            text: badgeLabel(
              b.code
            ),
          })
        )
      )
    );
  }

  identity.append(
    h("div", {
      class: "presence",
    }, [
      h("i", {
        class: "presence-dot",
      }),
      h("span", {
        text: presenceFor(
          state.me
        ),
      }),
    ])
  );

  if (
    state.me.email &&
    !state.me.emailVerified
  ) {
    identity.append(
      h("div", {
        class: "inline-note",
        text:
          "Your email is not verified yet. Open Settings to resend the verification message.",
      })
    );
  }

  hero.append(identity);

  hero.append(
    h("div", {
      class: "profile-actions",
    }, [
      h("a", {
        class: "primary-btn",
        href: "#settings",
        text: "Edit profile",
      }),
      h("a", {
        class: "secondary-btn",
        href:
          `#player?username=${
            encodeURIComponent(
              state.me.username
            )
          }`,
        text: "Public view",
      }),
    ])
  );

  root.append(hero);

  const ratingWrap = h("div", {
    class: "rating-grid",
  });

  for (
    const r of state.ratings
      .filter(
        x => x.category !== "puzzle"
      )
      .slice(0, 4)
  ) {
    ratingWrap.append(
      ratingCard(r)
    );
  }

  root.append(
    sectionCard(
      "Chess ratings",
      ratingWrap
    )
  );

  const puzzle = h("div", {
    class: "puzzle-highlight",
  });

  puzzle.append(
    h("div", {
      class: "metric",
      text: formatRating(
        state.puzzle?.rating
      ),
    }),
    h("div", {
      class: "metric-label",
      text: "Puzzle rating",
    }),
    h("div", {
      class: "mini-stats",
      text:
        `${state.puzzle?.solves || 0} solved · ` +
        `${state.puzzle?.best_streak || 0} best streak · ` +
        `${state.puzzle?.games || 0} attempts`,
    })
  );

  root.append(
    sectionCard(
      "Puzzle progress",
      puzzle
    )
  );

  const recent = h("div", {
    class: "list",
  });

  (state.games || [])
    .slice(0, 5)
    .forEach(g =>
      recent.append(gameRow(g))
    );

  if (!recent.children.length) {
    recent.append(
      h("div", {
        class: "empty",
        text:
          "Your online game history will appear here.",
      })
    );
  }

  root.append(
    sectionCard(
      "Recent games",
      recent
    )
  );

  const achievementList = h(
    "div",
    { class: "badge-row" }
  );

  (state.badges || []).forEach(b =>
    achievementList.append(
      h("span", {
        class: "badge",
        text: badgeLabel(
          b.code
        ),
      })
    )
  );

  if (!achievementList.children.length) {
    achievementList.append(
      h("div", {
        class: "empty",
        text:
          "Milestones will appear here as you play.",
      })
    );
  }

  root.append(
    sectionCard(
      "Achievements",
      achievementList
    )
  );
}

function displayGameResult(g) {
  const mineWasWhite =
    g.whiteUserId === state.me.id;

  if (g.result === "draw") {
    return {
      label: "Draw",
      cls: "draw",
    };
  }

  if (g.result === "aborted") {
    return {
      label: "Aborted",
      cls: "muted-result",
    };
  }

  const mineWon =
    (g.result === "white") ===
    mineWasWhite;

  return {
    label: mineWon
      ? "Win"
      : "Loss",
    cls: mineWon
      ? "win"
      : "loss",
  };
}

function gameRow(g) {
  const result =
    displayGameResult(g);

  const opponent =
    g.whiteUserId === state.me.id
      ? g.blackUsername
      : g.whiteUsername;

  const row = h("div", {
    class: "list-row game-row",
  });

  row.append(
    h("div", {
      class: "game-main",
    }, [
      h("strong", {
        text:
          opponent ||
          "Guest / unknown",
      }),
      h("small", {
        text:
          `${String(
            g.category || ""
          ).toUpperCase()} · ` +
          `${g.timeControl || "—"} · ` +
          `${g.rated ? "Rated" : "Casual"}`,
      }),
    ])
  );

  row.append(
    h("span", {
      class: `pill ${result.cls}`,
      text: result.label,
    })
  );

  row.append(
    h("time", {
      text: safeDate(
        g.createdAt
      ),
    })
  );

  return row;
}

function renderGames() {
  clearContent();

  const root = $("#content");

  root.append(
    pageHead(
      "Game history",
      "Your recorded online games, ratings and PGNs."
    )
  );

  const card = h("section", {
    class: "card",
  });

  const toolbar = h("div", {
    class: "toolbar",
  });

  const category =
    document.createElement("select");

  [
    "all",
    "rapid",
    "blitz",
    "bullet",
    "classical",
  ].forEach(v =>
    category.append(
      h("option", {
        value: v,
        text:
          v === "all"
            ? "All games"
            : v.charAt(0)
                .toUpperCase() +
              v.slice(1),
      })
    )
  );

  category.value =
    state.gamesCategory;

  toolbar.append(category);

  const list = h("div", {
    class: "list",
  });

  const paging = h("div", {
    class: "modal-actions",
  });

  const prev = h("button", {
    class: "secondary-btn",
    text: "Previous",
  });

  const pageLabel = h("span", {
    class: "muted small-text",
    text: "Page 1",
  });

  const next = h("button", {
    class: "secondary-btn",
    text: "Next",
  });

  paging.append(
    prev,
    pageLabel,
    next
  );

  card.append(
    toolbar,
    list,
    paging
  );

  root.append(card);

  const load = async () => {
    list.replaceChildren(
      h("div", {
        class: "empty",
        text: "Loading games…",
      })
    );

    try {
      state.gamesCategory =
        category.value;

      const path =
        category.value === "all"
          ? `/games?page=${state.gamesPage}&limit=20`
          : `/games?page=${state.gamesPage}&limit=20&category=${category.value}`;

      const d = await api(path);

      list.replaceChildren();

      (d.games || []).forEach(g => {
        const row = gameRow(g);

        const view = h("button", {
          class: "secondary-btn",
          text: "View",
        });

        view.onclick = () =>
          openGameDetails(g);

        row.append(
          h("div", {
            class: "chips",
          }, [view])
        );

        list.append(row);
      });

      if (!list.children.length) {
        list.append(
          h("div", {
            class: "empty",
            text:
              state.gamesPage === 1
                ? "No games match this filter."
                : "No more games.",
          })
        );
      }

      prev.disabled =
        state.gamesPage <= 1;

      next.disabled = !d.hasMore;

      pageLabel.textContent =
        `Page ${d.page}`;
    } catch (e) {
      list.replaceChildren(
        h("div", {
          class: "empty",
          text:
            humanizeError(e),
        })
      );

      prev.disabled = true;
      next.disabled = true;
    }
  };

  category.addEventListener(
    "change",
    () => {
      state.gamesPage = 1;
      load();
    }
  );

  prev.onclick = () => {
    if (state.gamesPage > 1) {
      state.gamesPage--;
      load();
    }
  };

  next.onclick = () => {
    state.gamesPage++;
    load();
  };

  load();
}

function openGameDetails(g) {
  const m = $("#modal");

  m.hidden = false;
  m.replaceChildren();

  const card = h("div", {
    class: "modal-card",
  });

  const result =
    displayGameResult(g);

  const whiteScore =
    g.result === "white"
      ? "1"
      : g.result === "draw"
      ? "½"
      : "0";

  const blackScore =
    g.result === "black"
      ? "1"
      : g.result === "draw"
      ? "½"
      : "0";

  card.append(
    h("h3", {
      text:
        `${g.whiteUsername || "White"} ` +
        `${whiteScore} — ` +
        `${g.blackUsername || "Black"} ` +
        `${blackScore}`,
    }),
    h("p", {
      class: "muted",
      text:
        `${String(
          g.category || ""
        ).toUpperCase()} · ` +
        `${g.timeControl || "—"} · ` +
        `${g.rated ? "Rated" : "Casual"} · ` +
        `${result.label}`,
    }),
    h("div", {
      class: "game-details",
    }, [
      h("div", {
        class: "pgn-box",
        text:
          g.pgn ||
          "PGN not available for this game.",
      }),
    ])
  );

  const actions = h("div", {
    class: "modal-actions",
  });

  const copy = h("button", {
    class: "secondary-btn",
    text: "Copy PGN",
  });

  copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(
        g.pgn || ""
      );
      toast(
        "PGN copied.",
        "success"
      );
    } catch {
      toast(
        "Copy failed.",
        "error"
      );
    }
  };

  const close = h("button", {
    class: "primary-btn",
    text: "Close",
  });

  close.onclick = () =>
    (m.hidden = true);

  actions.append(
    copy,
    close
  );

  card.append(actions);
  m.append(card);
}

function renderStats() {
  clearContent();

  const root = $("#content");

  root.append(
    pageHead(
      "Statistics",
      "A clear record of your play across time controls."
    )
  );

  const s = state.stats || {
    games: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    winRate: 0,
  };

  root.append(
    h("div", {
      class: "grid grid-4",
    }, [
      metricCard(
        s.games,
        "Games"
      ),
      metricCard(
        s.wins,
        "Wins"
      ),
      metricCard(
        s.draws,
        "Draws"
      ),
      metricCard(
        `${s.winRate}%`,
        "Win rate"
      ),
    ])
  );

  const ratingWrap = h("div", {
    class: "rating-grid",
  });

  state.ratings.forEach(r =>
    ratingWrap.append(
      ratingCard(r)
    )
  );

  root.append(
    sectionCard(
      "Rating snapshot",
      ratingWrap
    )
  );

  root.append(
    sectionCard(
      "Rating history",
      historyPanel()
    )
  );

  root.append(
    sectionCard(
      "Puzzle performance",
      h("div", {
        class: "stats-line",
      }, [
        h("span", {
          text:
            `${state.puzzle?.games || 0} attempts`,
        }),
        h("span", {
          text:
            `${state.puzzle?.solves || 0} solved`,
        }),
        h("span", {
          text:
            `${state.puzzle?.streak || 0} current streak`,
        }),
        h("span", {
          text:
            `${state.puzzle?.best_streak || 0} best streak`,
        }),
      ])
    )
  );
}

function metricCard(
  value,
  label
) {
  return h("div", {
    class: "card metric-card",
  }, [
    h("div", {
      class: "metric",
      text: String(value),
    }),
    h("div", {
      class: "metric-label",
      text: label,
    }),
  ]);
}

function historyPanel() {
  const wrap = h("div", {
    class: "history-wrap",
  });

  for (const category of [
    "rapid",
    "blitz",
    "bullet",
    "classical",
  ]) {
    const history =
      state.ratingHistory[
        category
      ] || [];

    const row = h("div", {
      class: "history-row",
    });

    row.append(
      h("div", {
        class: "history-name",
        text:
          category.charAt(0)
            .toUpperCase() +
          category.slice(1),
      }),
      h("div", {
        class: "sparkline",
        "aria-label":
          `${category} rating history`,
      }, [
        sparkline(history),
      ])
    );

    const current =
      state.ratings.find(
        r =>
          r.category ===
          category
      );

    row.append(
      h("strong", {
        text: formatRating(
          current?.rating
        ),
      })
    );

    wrap.append(row);
  }

  return wrap;
}

function sparkline(history) {
  const points = (history || [])
    .map(
      x =>
        Number(
          x.rating_after
        )
    )
    .filter(Number.isFinite);

  const svg =
    document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg"
    );

  svg.setAttribute(
    "viewBox",
    "0 0 240 44"
  );

  svg.setAttribute(
    "preserveAspectRatio",
    "none"
  );

  const baseline =
    document.createElementNS(
      "http://www.w3.org/2000/svg",
      "line"
    );

  baseline.setAttribute(
    "x1",
    "0"
  );
  baseline.setAttribute(
    "x2",
    "240"
  );
  baseline.setAttribute(
    "y1",
    "40"
  );
  baseline.setAttribute(
    "y2",
    "40"
  );
  baseline.setAttribute(
    "stroke",
    "currentColor"
  );
  baseline.setAttribute(
    "opacity",
    ".14"
  );

  svg.append(baseline);

  if (points.length < 2) {
    return svg;
  }

  const min =
    Math.min(...points);

  const max =
    Math.max(...points);

  const range =
    Math.max(1, max - min);

  const poly =
    document.createElementNS(
      "http://www.w3.org/2000/svg",
      "polyline"
    );

  poly.setAttribute(
    "fill",
    "none"
  );

  poly.setAttribute(
    "stroke",
    "currentColor"
  );

  poly.setAttribute(
    "stroke-width",
    "2"
  );

  poly.setAttribute(
    "points",
    points
      .map(
        (v, i) =>
          `${(i / (points.length - 1)) * 240},${
            38 -
            ((v - min) / range) * 32
          }`
      )
      .join(" ")
  );

  svg.append(poly);

  return svg;
}

function renderFriends() {
  clearContent();

  const root = $("#content");

  root.append(
    pageHead(
      "Friends & challenges",
      "Find players, manage requests and challenge friends."
    )
  );

  const searchCard = h("section", {
    class: "card",
  });

  searchCard.append(
    h("div", {
      class: "card-head",
    }, [
      h("h3", {
        text: "Find a player",
      }),
    ])
  );

  const form = h("form", {
    class: "search-row",
  });

  const input = h("input", {
    type: "search",
    placeholder:
      "Search username",
    autocomplete: "off",
    "aria-label":
      "Search username",
  });

  const button = h("button", {
    class: "primary-btn",
    type: "submit",
    text: "Search",
  });

  form.append(input, button);

  const results = h("div", {
    class: "list",
  });

  form.addEventListener(
    "submit",
    async e => {
      e.preventDefault();
      results.replaceChildren();

      const query =
        input.value.trim();

      if (query.length < 2) {
        return toast(
          "Enter at least 2 characters.",
          "error"
        );
      }

      try {
        const d = await api(
          `/search?q=${encodeURIComponent(
            query
          )}`
        );

        if (!d.users.length) {
          results.append(
            h("div", {
              class: "empty",
              text:
                "No players found.",
            })
          );
        }

        for (const u of d.users) {
          results.append(
            playerRow(u)
          );
        }
      } catch (e) {
        toast(
          humanizeError(e),
          "error"
        );
      }
    }
  );

  searchCard.append(
    form,
    results
  );

  root.append(searchCard);

  const requests = h("div", {
    class: "grid grid-2",
  });

  const incoming = h("div", {
    class: "card",
  });

  incoming.append(
    h("div", {
      class: "card-head",
    }, [
      h("h3", {
        text:
          `Friend requests (${state.incomingRequests.length})`,
      }),
    ])
  );

  const inList = h("div", {
    class: "list",
  });

  for (
    const req of
    state.incomingRequests
  ) {
    const row = h("div", {
      class: "list-row",
    });

    row.append(
      h("div", {
        class: "person",
      }, [
        userAvatar({
          username: req.username,
          avatarUrl:
            req.avatar_key
              ? `/api/account/avatar/${encodeURIComponent(
                  req.requester_id
                )}`
              : null,
        }, "tiny-avatar"),
        h("div", {}, [
          h("strong", {
            text: req.username,
          }),
          h("small", {
            text:
              req.displayName ||
              req.username,
          }),
        ]),
      ])
    );

    const acts = h("div", {
      class: "chips",
    });

    const accept = h("button", {
      class: "primary-btn",
      text: "Accept",
    });

    const decline = h("button", {
      class: "secondary-btn",
      text: "Decline",
    });

    accept.onclick = () =>
      respondFriend(
        req.requester_id,
        "accept"
      );

    decline.onclick = () =>
      respondFriend(
        req.requester_id,
        "decline"
      );

    acts.append(
      accept,
      decline
    );

    row.append(acts);
    inList.append(row);
  }

  if (!inList.children.length) {
    inList.append(
      h("div", {
        class: "empty",
        text:
          "No pending requests.",
      })
    );
  }

  incoming.append(inList);
  requests.append(incoming);

  const friends = h("div", {
    class: "card",
  });

  friends.append(
    h("div", {
      class: "card-head",
    }, [
      h("h3", {
        text:
          `Friends (${state.friends.length})`,
      }),
    ])
  );

  const friendList = h("div", {
    class: "list",
  });

  for (
    const f of state.friends
  ) {
    const person = h("div", {
      class: "list-row",
    });

    const user = {
      username: f.username,
      displayName:
        f.display_name,
      avatarUrl:
        f.avatar_key
          ? `/api/account/avatar/${encodeURIComponent(
              f.uid
            )}`
          : null,
    };

    person.append(
      h("div", {
        class: "person",
      }, [
        userAvatar(
          user,
          "tiny-avatar"
        ),
        h("div", {}, [
          h("strong", {
            text: f.username,
          }),
          h("small", {
            text:
              f.last_seen_at
                ? safeDateTime(
                    f.last_seen_at
                  )
                : "Offline",
          }),
        ]),
      ])
    );

    const actions = h("div", {
      class: "chips",
    });

    const challenge = h("button", {
      class: "secondary-btn",
      text: "Challenge",
    });

    challenge.onclick = () =>
      openChallenge({
        id: f.uid,
        username:
          f.username,
        displayName:
          f.display_name,
        avatarUrl:
          user.avatarUrl,
      });

    const remove = h("button", {
      class: "secondary-btn",
      text: "Remove",
    });

    remove.onclick = () =>
      removeFriend(f.uid);

    actions.append(
      challenge,
      remove
    );

    person.append(actions);
    friendList.append(person);
  }

  if (!friendList.children.length) {
    friendList.append(
      h("div", {
        class: "empty",
        text:
          "Add players to build your friends list.",
      })
    );
  }

  friends.append(friendList);
  requests.append(friends);
  root.append(requests);

  const challenges = h("section", {
    class: "card",
  });

  challenges.append(
    h("div", {
      class: "card-head",
    }, [
      h("h3", {
        text:
          "Recent challenges",
      }),
    ])
  );

  const challengeList = h("div", {
    class: "list",
  });

  for (
    const c of
    state.challenges.slice(
      0,
      12
    )
  ) {
    challengeList.append(
      challengeRow(c)
    );
  }

  if (
    !challengeList.children.length
  ) {
    challengeList.append(
      h("div", {
        class: "empty",
        text:
          "No challenges yet.",
      })
    );
  }

  challenges.append(
    challengeList
  );

  root.append(challenges);
}

function playerRow(u) {
  const row = h("div", {
    class: "list-row",
  });

  const person = h("div", {
    class: "person",
  });

  person.append(
    userAvatar(
      u,
      "tiny-avatar"
    ),
    h("div", {}, [
      h("strong", {
        text: u.username,
      }),
      h("small", {
        text:
          u.displayName ||
          u.username,
      }),
    ])
  );

  const actions = h("div", {
    class: "chips",
  });

  actions.append(
    h("a", {
      class: "secondary-btn",
      href:
        `#player?username=${encodeURIComponent(
          u.username
        )}`,
      text: "View",
    }),
    h("button", {
      class: "secondary-btn",
      text: "Add friend",
      onclick: () =>
        sendFriendRequest(
          u.id
        ),
    }),
    h("button", {
      class: "secondary-btn",
      text: "Follow",
      onclick: () =>
        followUser(
          u.id
        ),
    }),
    h("button", {
      class: "secondary-btn",
      text: "Challenge",
      onclick: () =>
        openChallenge(u),
    })
  );

  row.append(
    person,
    actions
  );

  return row;
}

async function sendFriendRequest(
  userId
) {
  try {
    await api(
      "/friends/request",
      {
        method: "POST",
        body: { userId },
      }
    );

    toast(
      "Friend request sent.",
      "success"
    );

    await refreshData();
    renderRoute();
  } catch (e) {
    toast(
      humanizeError(e),
      "error"
    );
  }
}

async function respondFriend(
  userId,
  action
) {
  try {
    await api(
      "/friends/respond",
      {
        method: "POST",
        body: {
          userId,
          action,
        },
      }
    );

    toast(
      action === "accept"
        ? "Friend request accepted."
        : "Request declined.",
      "success"
    );

    await refreshData();
    renderRoute();
  } catch (e) {
    toast(
      humanizeError(e),
      "error"
    );
  }
}

async function removeFriend(
  userId
) {
  try {
    await api(
      "/friends/remove",
      {
        method: "POST",
        body: { userId },
      }
    );

    toast("Friend removed.");
    await refreshData();
    renderRoute();
  } catch (e) {
    toast(
      humanizeError(e),
      "error"
    );
  }
}

async function followUser(
  userId
) {
  try {
    const d = await api(
      "/follow",
      {
        method: "POST",
        body: { userId },
      }
    );

    toast(
      d.alreadyFollowing
        ? "Already following."
        : "Now following.",
      "success"
    );
  } catch (e) {
    toast(
      humanizeError(e),
      "error"
    );
  }
}

function challengeRow(c) {
  const row = h("div", {
    class: "list-row",
  });

  const mineSender =
    c.sender_id === state.me.id;

  const other =
    mineSender
      ? c.recipient_username
      : c.sender_username;

  row.append(
    h("div", {
      class: "challenge-main",
    }, [
      h("strong", {
        text:
          `${mineSender ? "To" : "From"} ${other}`,
      }),
      h("small", {
        text:
          `${c.category} · ` +
          `${c.time_control} · ` +
          `${c.rated ? "Rated" : "Casual"}` +
          `${c.rematch_of ? " · Rematch" : ""}`,
      }),
    ])
  );

  row.append(
    h("span", {
      class:
        `pill ${
          c.status === "pending"
            ? "gold"
            : c.status === "accepted"
            ? "green"
            : "muted-result"
        }`,
      text: c.status,
    })
  );

  const actions = h("div", {
    class: "chips",
  });

  if (
    c.recipient_id ===
      state.me.id &&
    c.status === "pending"
  ) {
    const accept = h("button", {
      class: "primary-btn",
      text: "Accept",
    });

    const decline = h("button", {
      class: "secondary-btn",
      text: "Decline",
    });

    accept.onclick = () =>
      respondChallenge(
        c.id,
        "accept"
      );

    decline.onclick = () =>
      respondChallenge(
        c.id,
        "decline"
      );

    actions.append(
      accept,
      decline
    );
  }

  if (c.status === "accepted") {
    const otherId =
      mineSender
        ? c.recipient_id
        : c.sender_id;

    const rematch = h(
      "button",
      {
        class: "secondary-btn",
        text: "Rematch",
      }
    );

    rematch.onclick =
      async () => {
        try {
          await api(
            "/challenge",
            {
              method:
                "POST",
              body: {
                recipientId:
                  otherId,
                timeControl:
                  c.time_control,
                category:
                  c.category,
                rated:
                  !!c.rated,
                rematchOf:
                  c.id,
              },
            }
          );

          toast(
            "Rematch challenge sent.",
            "success"
          );

          await refreshData();
          renderRoute();
        } catch (e) {
          toast(
            humanizeError(e),
            "error"
          );
        }
      };

    actions.append(
      rematch
    );
  }

  if (actions.children.length) {
    row.append(actions);
  }

  return row;
}

async function respondChallenge(
  challengeId,
  action
) {
  try {
    await api(
      "/challenge/respond",
      {
        method: "POST",
        body: {
          challengeId,
          action,
        },
      }
    );

    toast(
      action === "accept"
        ? "Challenge accepted."
        : "Challenge declined.",
      "success"
    );

    await refreshData();
    renderRoute();
  } catch (e) {
    toast(
      humanizeError(e),
      "error"
    );
  }
}

function openChallenge(user) {
  const m = $("#modal");

  m.hidden = false;
  m.replaceChildren();

  const card = h("div", {
    class: "modal-card",
  });

  card.append(
    h("h3", {
      text:
        `Challenge ${user.username}`,
    }),
    h("p", {
      class: "muted",
      text:
        "Choose the time control and rating mode.",
    })
  );

  const time =
    document.createElement("select");

  [
    "1+0",
    "3+0",
    "3+2",
    "5+0",
    "5+3",
    "10+0",
    "10+5",
    "15+10",
    "30+0",
  ].forEach(v =>
    time.append(
      h("option", {
        value: v,
        text: v,
      })
    )
  );

  time.value = "10+0";

  const mode =
    document.createElement("select");

  [
    "casual",
    "rated",
  ].forEach(v =>
    mode.append(
      h("option", {
        value: v,
        text:
          v === "rated"
            ? "Rated"
            : "Casual",
      })
    )
  );

  card.append(
    h("label", {
      class: "field",
    }, [
      "Time control",
      time,
    ]),
    h("label", {
      class: "field",
    }, [
      "Game mode",
      mode,
    ])
  );

  const actions = h("div", {
    class: "modal-actions",
  });

  const close = h("button", {
    class: "secondary-btn",
    text: "Cancel",
  });

  close.onclick = () =>
    (m.hidden = true);

  const send = h("button", {
    class: "primary-btn",
    text: "Send challenge",
  });

  send.onclick = async () => {
    try {
      const minutes =
        Number(
          time.value.split("+")[0]
        );

      const seconds =
        minutes * 60;

      const category =
        seconds < 180
          ? "bullet"
          : seconds < 600
          ? "blitz"
          : seconds <= 1800
          ? "rapid"
          : "classical";

      await api(
        "/challenge",
        {
          method: "POST",
          body: {
            recipientId: user.id,
            timeControl:
              time.value,
            category,
            rated:
              mode.value === "rated",
          },
        }
      );

      m.hidden = true;

      toast(
        "Challenge sent.",
        "success"
      );

      await refreshData();
      renderRoute();
    } catch (e) {
      toast(
        humanizeError(e),
        "error"
      );
    }
  };

  actions.append(
    close,
    send
  );

  card.append(actions);
  m.append(card);
  time.focus();
}

function renderTournaments() {
  clearContent();

  const root = $("#content");

  root.append(
    pageHead(
      "Tournaments",
      "Join scheduled events and follow published standings."
    )
  );

  const card = h("section", {
    class: "card",
  });

  const list = h("div", {
    class: "list",
  });

  card.append(
    h("div", {
      class: "card-head",
    }, [
      h("h3", {
        text:
          "Available tournaments",
      }),
    ]),
    list
  );

  root.append(card);

  api("/tournaments")
    .then(d => {
      list.replaceChildren();

      (d.tournaments || [])
        .forEach(t => {
          const row = h("div", {
            class: "tournament-row",
          });

          const status =
            String(
              t.status ||
              "scheduled"
            );

          const main = h("div", {
            class:
              "tournament-main",
          });

          main.append(
            h("strong", {
              text: t.name,
            }),
            h("small", {
              text:
                `${t.category} · ` +
                `${t.time_control} · ` +
                `${t.rated ? "Rated" : "Casual"} · ` +
                `starts ${safeDateTime(
                  t.starts_at
                )}`,
            })
          );

          if (t.description) {
            main.append(
              h("small", {
                text:
                  String(
                    t.description
                  ).slice(
                    0,
                    180
                  ),
              })
            );
          }

          row.append(
            main,
            h("span", {
              class: "pill",
              text: status,
            })
          );

          const actions = h(
            "div",
            {
              class: "chips",
            }
          );

          const join = h("button", {
            class:
              "secondary-btn",
            text: "Join",
          });

          join.onclick =
            async () => {
              try {
                const d =
                  await api(
                    "/tournaments/join",
                    {
                      method:
                        "POST",
                      body: {
                        tournamentId:
                          t.id,
                      },
                    }
                  );

                toast(
                  d.alreadyJoined
                    ? "You are already registered."
                    : "Joined tournament.",
                  "success"
                );
              } catch (e) {
                toast(
                  humanizeError(e),
                  "error"
                );
              }
            };

          if (
            status === "finished" ||
            status === "cancelled"
          ) {
            join.disabled =
              true;
          }

          const standings =
            h("button", {
              class:
                "secondary-btn",
              text: "Standings",
            });

          standings.onclick =
            () =>
              openTournamentStandings(
                t
              );

          actions.append(
            join,
            standings
          );

          row.append(actions);
          list.append(row);
        });

      if (!list.children.length) {
        list.append(
          h("div", {
            class: "empty",
            text:
              "No tournaments are published yet.",
          })
        );
      }
    })
    .catch(e =>
      list.replaceChildren(
        h("div", {
          class: "empty",
          text:
            humanizeError(e),
        })
      )
    );
}

async function openTournamentStandings(
  t
) {
  const m = $("#modal");

  m.hidden = false;
  m.replaceChildren();

  const c = h("div", {
    class: "modal-card",
  });

  c.append(
    h("h3", {
      text:
        `${t.name} — standings`,
    }),
    h("p", {
      class: "muted",
      text:
        "Current published standings.",
    })
  );

  const list = h("div", {
    class: "list",
  });

  c.append(list);

  const close = h("button", {
    class: "primary-btn",
    text: "Close",
  });

  close.onclick = () =>
    (m.hidden = true);

  c.append(
    h("div", {
      class: "modal-actions",
    }, [close])
  );

  m.append(c);

  try {
    const d =
      await api(
        `/tournaments/standings?id=${encodeURIComponent(
          t.id
        )}`
      );

    (d.standings || [])
      .forEach(x =>
        list.append(
          h("div", {
            class:
              "leader-row",
          }, [
            h("strong", {
              class: "rank",
              text:
                String(
                  x.rank
                ),
            }),
            h("div", {
              class: "person",
            }, [
              userAvatar({
                username:
                  x.username,
                avatarUrl:
                  x.avatarUrl,
              }, "tiny-avatar"),
              h("div", {}, [
                h("strong", {
                  text:
                    x.username,
                }),
                h("small", {
                  text:
                    `${x.score} points · ${x.wins} wins`,
                }),
              ]),
            ]),
            h("div", {
              class:
                "leader-rating",
            }, [
              h("strong", {
                text:
                  String(
                    x.score
                  ),
              }),
              h("small", {
                text:
                  `${x.games} games`,
              }),
            ]),
          ])
        )
      );

    if (!list.children.length) {
      list.append(
        h("div", {
          class: "empty",
          text:
            "No entries yet.",
        })
      );
    }
  } catch (e) {
    list.append(
      h("div", {
        class: "empty",
        text:
          humanizeError(e),
      })
    );
  }
}

function renderLeaderboard() {
  clearContent();

  const root = $("#content");

  root.append(
    pageHead(
      "Leaderboards",
      "Top public players by rating."
    )
  );

  const toolbar = h("div", {
    class: "toolbar",
  });

  const select =
    document.createElement("select");

  [
    "rapid",
    "blitz",
    "bullet",
    "classical",
    "puzzle",
  ].forEach(v =>
    select.append(
      h("option", {
        value: v,
        text:
          v.charAt(0)
            .toUpperCase() +
          v.slice(1),
      })
    )
  );

  toolbar.append(select);

  root.append(
    h("section", {
      class: "card",
    }, [
      h("div", {
        class: "card-head",
      }, [
        h("h3", {
          text:
            "Leaderboard",
        }),
      ]),
      toolbar,
      h("div", {
        id:
          "leaderboardList",
        class:
          "leaderboard-list",
      }),
    ])
  );

  const draw = async () => {
    try {
      const d =
        await api(
          `/leaderboard?category=${select.value}`
        );

      const list =
        $("#leaderboardList");

      list.replaceChildren();

      d.players.forEach(p => {
        const row = h("div", {
          class:
            "leader-row",
        });

        row.append(
          h("strong", {
            class: "rank",
            text:
              String(
                p.rank
              ),
          }),
          h("div", {
            class: "person",
          }, [
            userAvatar(
              p,
              "tiny-avatar"
            ),
            h("div", {}, [
              h("strong", {
                text:
                  p.username,
              }),
              h("small", {
                text:
                  p.displayName ||
                  p.username,
              }),
            ]),
          ]),
          h("div", {
            class:
              "leader-rating",
          }, [
            h("strong", {
              text:
                formatRating(
                  p.rating
                ),
            }),
            h("small", {
              text:
                `${p.games} games`,
            }),
          ])
        );

        list.append(row);
      });

      if (!list.children.length) {
        list.append(
          h("div", {
            class: "empty",
            text:
              "No ranked players yet.",
          })
        );
      }
    } catch (e) {
      toast(
        humanizeError(e),
        "error"
      );
    }
  };

  select.addEventListener(
    "change",
    draw
  );

  draw();
}

function renderSettings() {
  clearContent();

  const root = $("#content");

  root.append(
    pageHead(
      "Settings",
      "Manage your profile, gameplay preferences and privacy."
    )
  );

  const profile = h("section", {
    class: "card",
  });

  profile.append(
    h("div", {
      class: "card-head",
    }, [
      h("h3", {
        text: "Profile",
      }),
    ])
  );

  const grid = h("div", {
    class: "form-grid",
  });

  for (
    const [
      label,
      key,
      value,
    ] of [
      [
        "Username",
        "username",
        state.me.username,
      ],
      [
        "Display name",
        "displayName",
        state.me.displayName,
      ],
      [
        "Country",
        "country",
        state.me.country || "",
      ],
      [
        "Timezone",
        "timezone",
        state.me.timezone || "",
      ],
    ]
  ) {
    const l = h("label", {
      class: "field",
    }, [label]);

    const input = h("input", {
      name: key,
      value,
      autocomplete:
        key === "username"
          ? "username"
          : "off",
    });

    l.append(input);
    grid.append(l);
  }

  const about = h("label", {
    class: "field",
  }, ["About"]);

  const ta = h("textarea", {
    name: "about",
    maxlength: "500",
  });

  ta.value =
    state.me.about || "";

  about.append(ta);

  profile.append(
    grid,
    about
  );

  const save = h("button", {
    class: "primary-btn",
    text: "Save profile",
  });

  save.onclick = async () => {
    const body =
      Object.fromEntries(
        [...grid.querySelectorAll("input")]
          .map(i => [
            i.name,
            i.value,
          ])
      );

    body.about =
      ta.value;

    try {
      const d =
        await api(
          "/profile",
          {
            method:
              "PATCH",
            body,
          }
        );

      if (d.user) {
        state.me =
          d.user;
      } else {
        const refreshed =
          await api(
            "/me"
          );

        if (
          refreshed.authenticated
        ) {
          state.me =
            refreshed.user;
        }
      }

      renderSide();

      toast(
        "Profile saved.",
        "success"
      );
    } catch (e) {
      toast(
        humanizeError(e),
        "error"
      );
    }
  };

  profile.append(
    h("div", {
      class:
        "modal-actions",
    }, [save])
  );

  root.append(profile);

  const avatar = h("section", {
    class: "card",
  });

  avatar.append(
    h("div", {
      class: "card-head",
    }, [
      h("h3", {
        text:
          "Profile picture",
      }),
    ])
  );

  const preview = userAvatar(
    state.me,
    "avatar-preview"
  );

  preview.alt =
    "Current profile picture preview";

  const file = h("input", {
    type: "file",
    accept:
      "image/jpeg,image/png,image/webp",
  });

  file.addEventListener(
    "change",
    () => {
      const selected =
        file.files?.[0];

      if (!selected) return;

      const url =
        URL.createObjectURL(
          selected
        );

      preview.src = url;

      preview.onload = () =>
        URL.revokeObjectURL(
          url
        );
    }
  );

  const hint = h("p", {
    class:
      "muted small-text",
    text:
      "JPEG, PNG or WebP · up to 512 KiB after automatic compression. A live preview appears before upload.",
  });

  const upload = h("button", {
    class:
      "secondary-btn",
    text:
      "Upload picture",
  });

  upload.onclick = async () => {
    const selected =
      file.files[0];

    if (!selected) {
      return toast(
        "Choose an image first.",
        "error"
      );
    }

    try {
      const prepared =
        await prepareAvatarFile(
          selected
        );

      const fd =
        new FormData();

      fd.append(
        "avatar",
        prepared,
        prepared.name ||
          "avatar.jpg"
      );

      const d =
        await api(
          "/avatar",
          {
            method:
              "POST",
            body: fd,
          }
        );

      state.me.avatarUrl =
        d.avatarUrl;

      renderSide();

      toast(
        "Profile picture updated.",
        "success"
      );
    } catch (e) {
      toast(
        humanizeError(e),
        "error"
      );
    }
  };

  avatar.append(
    file,
    hint,
    upload
  );

  root.append(avatar);

  const gameplay = h(
    "section",
    {
      class: "card",
    }
  );

  gameplay.append(
    h("div", {
      class: "card-head",
    }, [
      h("h3", {
        text: "Gameplay",
      }),
    ])
  );

  for (
    const key of [
      "sound",
      "animations",
      "premoves",
      "confirmMoves",
      "coordinates",
    ]
  ) {
    const label =
      key === "confirmMoves"
        ? "Confirm moves"
        : key.charAt(0)
              .toUpperCase() +
          key.slice(1);

    const row =
      settingToggle(
        label,
        key,
        Boolean(
          state.settings[key]
        ),
        key === "premoves"
          ? "Keep premove preferences synchronized across devices."
          : "Remember this preference."
      );

    gameplay.append(row);
  }

  root.append(gameplay);

  const privacy = h("section", {
    class: "card",
  });

  privacy.append(
    h("div", {
      class: "card-head",
    }, [
      h("h3", {
        text:
          "Privacy & social",
      }),
    ])
  );

  for (
    const [
      label,
      key,
      value,
      opts,
    ] of [
      [
        "Profile visibility",
        "profileVisibility",
        state.me
          .profileVisibility,
        [
          "public",
          "friends",
          "private",
        ],
      ],
      [
        "Friend requests",
        "friendRequestSetting",
        state.me
          .friendRequestSetting,
        [
          "everyone",
          "friends_of_friends",
          "nobody",
        ],
      ],
      [
        "Challenges",
        "challengeSetting",
        state.me
          .challengeSetting,
        [
          "everyone",
          "friends",
          "nobody",
        ],
      ],
    ]
  ) {
    const row = h("div", {
      class: "setting-row",
    });

    row.append(
      h("span", {}, [
        h("strong", {
          text: label,
        }),
        h("small", {
          text:
            "Control who can interact with your account.",
        }),
      ])
    );

    const sel =
      document.createElement(
        "select"
      );

    opts.forEach(v =>
      sel.append(
        h("option", {
          value: v,
          text:
            v.replaceAll(
              "_",
              " "
            ),
          selected:
            v === value,
        })
      )
    );

    sel.onchange = async () => {
      try {
        const d =
          await api(
            "/settings",
            {
              method:
                "PATCH",
              body: {
                [key]:
                  sel.value,
              },
            }
          );

        state.me = {
          ...state.me,
          profileVisibility:
            d.privacy
              .profileVisibility,
          onlineVisibility:
            !!d.privacy
              .onlineVisibility,
          friendRequestSetting:
            d.privacy
              .friendRequestSetting,
          challengeSetting:
            d.privacy
              .challengeSetting,
          searchable:
            !!d.privacy
              .searchable,
        };

        toast(
          "Privacy updated.",
          "success"
        );
      } catch (e) {
        toast(
          humanizeError(e),
          "error"
        );
      }
    };

    row.append(sel);
    privacy.append(row);
  }

  privacy.append(
    settingToggle(
      "Show online status",
      "onlineVisibility",
      !!state.me
        .onlineVisibility,
      "Allow other players to see when you are online."
    )
  );

  privacy.append(
    settingToggle(
      "Appear in player search",
      "searchable",
      !!state.me.searchable,
      "Let other players find your username."
    )
  );

  root.append(privacy);

  const email = h("section", {
    class: "card",
  });

  email.append(
    h("div", {
      class: "card-head",
    }, [
      h("h3", {
        text: "Email",
      }),
    ])
  );

  email.append(
    h("p", {
      class: "muted",
      text:
        state.me.email
          ? `${state.me.email} · ${
              state.me.emailVerified
                ? "Verified"
                : "Verification required"
            }`
          : "No email address is connected to this account.",
    })
  );

  if (
    !state.me.emailVerified &&
    state.me.email
  ) {
    const b = h("button", {
      class:
        "secondary-btn",
      text:
        "Resend verification email",
    });

    b.onclick = async () => {
      try {
        await api(
          "/verify-email/resend",
          {
            method:
              "POST",
            body: {},
          }
        );

        toast(
          "Verification email sent.",
          "success"
        );
      } catch (e) {
        toast(
          humanizeError(e),
          "error"
        );
      }
    };

    email.append(b);
  }

  if (state.me.email) {
    const change = h("button", {
      class:
        "secondary-btn",
      text:
        "Change email",
    });

    change.onclick = () =>
      openEmailChange();

    email.append(change);
  }

  root.append(email);

  const account = h("section", {
    class:
      "card danger-zone",
  });

  account.append(
    h("div", {
      class: "card-head",
    }, [
      h("h3", {
        text:
          "Account data",
      }),
    ])
  );

  const exportBtn = h(
    "button",
    {
      class:
        "secondary-btn",
      text:
        "Download my data",
    }
  );

  exportBtn.onclick = () => {
    location.href =
      "/api/account/export";
  };

  const migrate = h("button", {
    class:
      "secondary-btn",
    text:
      "Import guest progress",
  });

  migrate.onclick = async () => {
    try {
      const d =
        await api(
          "/guest/migrate",
          {
            method:
              "POST",
            body: {},
          }
        );

      await refreshData();
      toast(
        d.migrated
          ? "Guest progress imported."
          : "No guest progress was found.",
        "success"
      );
      renderRoute();
    } catch (e) {
      toast(
        humanizeError(e),
        "error"
      );
    }
  };

  const del = h("button", {
    class: "danger-btn",
    text:
      "Delete account",
  });

  del.onclick = () =>
    openDelete();

  account.append(
    h("div", {
      class: "chips",
    }, [
      exportBtn,
      migrate,
      del,
    ])
  );

  root.append(account);
}

function settingToggle(
  label,
  key,
  value,
  description
) {
  const row = h("div", {
    class:
      "setting-row",
  });

  row.append(
    h("span", {}, [
      h("strong", {
        text: label,
      }),
      h("small", {
        text: description,
      }),
    ])
  );

  const sw = h("input", {
    type: "checkbox",
    class: "switch",
    "aria-label":
      label,
  });

  sw.checked = value;

  sw.onchange = async () => {
    try {
      const body = {
        [key]:
          sw.checked,
      };

      const d =
        await api(
          "/settings",
          {
            method:
              "PATCH",
            body,
          }
        );

      state.settings =
        d.settings;

      if (
        [
          "onlineVisibility",
          "searchable",
        ].includes(key)
      ) {
        state.me = {
          ...state.me,
          onlineVisibility:
            !!d.privacy
              .onlineVisibility,
          searchable:
            !!d.privacy
              .searchable,
        };
      }

      toast(
        "Setting saved.",
        "success"
      );
    } catch (e) {
      sw.checked =
        !sw.checked;

      toast(
        humanizeError(e),
        "error"
      );
    }
  };

  row.append(sw);
  return row;
}

function openEmailChange() {
  const m = $("#modal");

  m.hidden = false;
  m.replaceChildren();

  const c = h("div", {
    class: "modal-card",
  });

  c.append(
    h("h3", {
      text:
        "Change email",
    }),
    h("p", {
      class: "muted",
      text:
        "We will send a verification link to your new address. Your current session will be signed out after the new address is verified.",
    })
  );

  const email = h("label", {
    class: "field",
  }, ["New email"]);

  const input = h("input", {
    type: "email",
    autocomplete: "email",
  });

  email.append(input);
  c.append(email);

  let password = null;

  if (
    state.me.passwordLoginEnabled
  ) {
    const pass = h("label", {
      class: "field",
    }, ["Current password"]);

    password = h("input", {
      type: "password",
      autocomplete:
        "current-password",
    });

    pass.append(password);
    c.append(pass);
  }

  const actions = h("div", {
    class:
      "modal-actions",
  });

  const close = h("button", {
    class:
      "secondary-btn",
    text: "Cancel",
  });

  const submit = h("button", {
    class:
      "primary-btn",
    text:
      "Send verification",
  });

  close.onclick = () =>
    (m.hidden = true);

  submit.onclick =
    async () => {
      try {
        await api(
          "/email/change",
          {
            method:
              "POST",
            body: {
              email:
                input.value,
              password:
                password?.value ||
                "",
            },
          }
        );

        m.hidden = true;

        toast(
          "Verification email sent.",
          "success"
        );
      } catch (e) {
        toast(
          humanizeError(e),
          "error"
        );
      }
    };

  actions.append(
    close,
    submit
  );

  c.append(actions);
  m.append(c);

  input.focus();
}

function renderSecurity() {
  clearContent();

  const root = $("#content");

  root.append(
    pageHead(
      "Security",
      "Protect your account and control where you are signed in."
    )
  );

  const two = h("section", {
    class: "card",
  });

  two.append(
    h("div", {
      class: "card-head",
    }, [
      h("h3", {
        text:
          "Two-factor authentication",
      }),
    ]),
    h("p", {
      class: "muted",
      text:
        state.me.twoFactorEnabled
          ? "Two-factor authentication is enabled."
          : "Add an authenticator app as a second layer of protection.",
    })
  );

  if (
    state.me.twoFactorEnabled
  ) {
    const b = h("button", {
      class:
        "secondary-btn",
      text:
        "Disable 2FA",
    });

    b.onclick = () =>
      disable2FA();

    two.append(b);
  } else {
    const b = h("button", {
      class:
        "primary-btn",
      text:
        "Enable 2FA",
    });

    b.onclick = () =>
      setup2FA();

    two.append(b);
  }

  root.append(two);

  const sessions = h("section", {
    class: "card",
  });

  sessions.append(
    h("div", {
      class: "card-head",
    }, [
      h("h3", {
        text:
          "Active sessions",
      }),
    ])
  );

  const list = h("div", {
    class: "list",
  });

  api("/security/sessions")
    .then(d => {
      for (
        const x of
        d.sessions
      ) {
        const row = h("div", {
          class: "list-row",
        });

        row.append(
          h("div", {}, [
            h("strong", {
              text:
                x.isCurrent
                  ? "Current device"
                  : "Signed-in device",
            }),
            h("small", {
              text:
                `${x.userAgent || "Browser"} · ` +
                `last active ${safeDateTime(
                  x.lastSeenAt
                )}`,
            }),
          ])
        );

        if (x.isCurrent) {
          row.append(
            h("span", {
              class:
                "pill green",
              text: "Current",
            })
          );
        } else {
          const b = h("button", {
            class:
              "secondary-btn",
            text: "Revoke",
          });

          b.onclick = async () => {
            try {
              await api(
                "/security/sessions/revoke",
                {
                  method:
                    "POST",
                  body: {
                    sessionId:
                      x.id,
                  },
                }
              );

              toast(
                "Session revoked.",
                "success"
              );

              renderSecurity();
            } catch (e) {
              toast(
                humanizeError(e),
                "error"
              );
            }
          };

          row.append(b);
        }

        list.append(row);
      }

      if (!list.children.length) {
        list.append(
          h("div", {
            class: "empty",
            text:
              "No sessions found.",
          })
        );
      }
    })
    .catch(e =>
      toast(
        humanizeError(e),
        "error"
      )
    );

  sessions.append(list);

  const all = h("button", {
    class:
      "secondary-btn",
    text:
      "Sign out other devices",
  });

  all.onclick = async () => {
    try {
      await api(
        "/security/sessions/revoke-all",
        {
          method:
            "POST",
          body: {},
        }
      );

      toast(
        "Other sessions signed out.",
        "success"
      );

      renderSecurity();
    } catch (e) {
      toast(
        humanizeError(e),
        "error"
      );
    }
  };

  sessions.append(all);
  root.append(sessions);

  const password = h(
    "section",
    {
      class: "card",
    }
  );

  password.append(
    h("div", {
      class: "card-head",
    }, [
      h("h3", {
        text: "Password",
      }),
    ])
  );

  if (
    state.me.passwordLoginEnabled
  ) {
    const grid = h("div", {
      class:
        "form-grid",
    });

    const a = h("label", {
      class: "field",
    }, ["Current password"]);

    const ai = h("input", {
      type: "password",
      autocomplete:
        "current-password",
    });

    a.append(ai);

    const b = h("label", {
      class: "field",
    }, ["New password"]);

    const bi = h("input", {
      type: "password",
      autocomplete:
        "new-password",
    });

    b.append(bi);
    grid.append(a, b);

    const btn = h("button", {
      class:
        "primary-btn",
      text:
        "Change password",
    });

    btn.onclick = async () => {
      try {
        await api(
          "/security/password",
          {
            method:
              "POST",
            body: {
              currentPassword:
                ai.value,
              newPassword:
                bi.value,
            },
          }
        );

        ai.value = "";
        bi.value = "";

        toast(
          "Password changed.",
          "success"
        );
      } catch (e) {
        toast(
          humanizeError(e),
          "error"
        );
      }
    };

    password.append(
      grid,
      btn
    );
  } else {
    password.append(
      h("div", {
        class: "notice",
        text:
          "This account uses external sign-in and has no local password.",
      })
    );
  }

  root.append(password);

  const google = h("section", {
    class: "card",
  });

  google.append(
    h("div", {
      class: "card-head",
    }, [
      h("h3", {
        text:
          "Connected sign-in",
      }),
    ]),
    h("p", {
      class: "muted",
      text:
        "Connect Google to make sign-in more convenient. The Google identity remains linked to your Advanced Chess user ID.",
    })
  );

  const gb = h("button", {
    class:
      "secondary-btn",
    text:
      "Connect Google",
  });

  gb.onclick = () => {
    location.href =
      "/api/account/google/start?mode=link";
  };

  google.append(gb);
  root.append(google);
}

async function setup2FA() {
  try {
    const d =
      await api(
        "/security/2fa/setup",
        {
          method:
            "POST",
          body: {},
        }
      );

    open2FAModal(
      d,
      false
    );
  } catch (e) {
    toast(
      humanizeError(e),
      "error"
    );
  }
}

async function disable2FA() {
  open2FAModal(
    {},
    true
  );
}

function open2FAModal(
  data,
  disabling
) {
  const m = $("#modal");

  m.hidden = false;
  m.replaceChildren();

  const c = h("div", {
    class:
      "modal-card",
  });

  c.append(
    h("h3", {
      text:
        disabling
          ? "Disable two-factor authentication"
          : "Set up two-factor authentication",
    })
  );

  if (!disabling) {
    c.append(
      h("p", {
        class: "muted",
        text:
          "Enter the secret into an authenticator app. The otpauth URI can be used by compatible password managers and authenticators.",
      }),
      h("div", {
        class: "secret",
        text: data.secret,
      }),
      h("details", {
        class:
          "advanced-detail",
      }, [
        h("summary", {
          text:
            "Show provisioning URI",
        }),
        h("div", {
          class: "secret",
          text:
            data.otpauthUri,
        }),
      ])
    );
  } else {
    c.append(
      h("p", {
        class: "muted",
        text:
          "Enter a current authenticator code or an unused backup code.",
      })
    );
  }

  const field = h("label", {
    class: "field",
  }, [
    "Authentication code",
  ]);

  const input = h("input", {
    inputMode: "numeric",
    autocomplete:
      "one-time-code",
    placeholder:
      "6-digit code",
  });

  field.append(input);
  c.append(field);

  const actions = h("div", {
    class:
      "modal-actions",
  });

  const close = h("button", {
    class:
      "secondary-btn",
    text:
      "Cancel",
  });

  const submit = h("button", {
    class:
      "primary-btn",
    text:
      disabling
        ? "Disable 2FA"
        : "Verify & enable",
  });

  close.onclick = () =>
    (m.hidden = true);

  submit.onclick = async () => {
    try {
      if (disabling) {
        await api(
          "/security/2fa/disable",
          {
            method:
              "POST",
            body: {
              code:
                input.value,
            },
          }
        );

        state.me =
          (
            await api(
              "/me"
            )
          ).user;

        m.hidden = true;

        toast(
          "2FA disabled.",
          "success"
        );

        renderSecurity();
      } else {
        const d =
          await api(
            "/security/2fa/verify",
            {
              method:
                "POST",
              body: {
                code:
                  input.value,
              },
            }
          );

        state.me =
          (
            await api(
              "/me"
            )
          ).user;

        m.hidden = true;
        openBackupCodes(
          d.backupCodes
        );
      }
    } catch (e) {
      toast(
        humanizeError(e),
        "error"
      );
    }
  };

  actions.append(
    close,
    submit
  );

  c.append(actions);
  m.append(c);

  input.focus();
}

function openBackupCodes(
  codes
) {
  const m = $("#modal");

  m.hidden = false;
  m.replaceChildren();

  const c = h("div", {
    class:
      "modal-card",
  });

  c.append(
    h("h3", {
      text:
        "Save your backup codes",
    }),
    h("p", {
      class: "muted",
      text:
        "Each code works once. Store them somewhere safe before closing this window.",
    })
  );

  const grid = h("div", {
    class:
      "backup-grid",
  });

  codes.forEach(code =>
    grid.append(
      h("div", {
        class:
          "backup-code",
        text: code,
      })
    )
  );

  c.append(grid);

  const actions = h(
    "div",
    {
      class:
        "modal-actions",
    }
  );

  const copy = h("button", {
    class:
      "primary-btn",
    text:
      "Copy codes",
  });

  copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(
        codes.join("\n")
      );

      toast(
        "Backup codes copied.",
        "success"
      );
    } catch {
      toast(
        "Copy failed. Please save them manually.",
        "error"
      );
    }
  };

  const done = h("button", {
    class:
      "secondary-btn",
    text:
      "Done",
  });

  done.onclick = () => {
    m.hidden = true;
    renderSecurity();
  };

  actions.append(
    copy,
    done
  );

  c.append(actions);
  m.append(c);
}

function renderNotifications() {
  clearContent();

  const root = $("#content");

  root.append(
    pageHead(
      "Notifications",
      "Friends, challenges and account activity."
    )
  );

  const card = h("section", {
    class: "card",
  });

  const list = h("div", {
    class: "list",
  });

  state.notifications.forEach(
    n => {
      const row = h("div", {
        class:
          `list-row notification-row ${
            n.readAt
              ? ""
              : "unread"
          }`,
      });

      row.append(
        h("div", {}, [
          h("strong", {
            text:
              notificationTitle(
                n
              ),
          }),
          h("small", {
            text:
              notificationText(
                n
              ),
          }),
        ]),
        h("time", {
          text:
            safeDateTime(
              n.createdAt
            ),
        })
      );

      list.append(row);
    }
  );

  if (!list.children.length) {
    list.append(
      h("div", {
        class: "empty",
        text:
          "You are all caught up.",
      })
    );
  }

  card.append(list);

  const all = h("button", {
    class:
      "secondary-btn",
    text:
      "Mark all as read",
  });

  all.onclick = async () => {
    try {
      await api(
        "/notifications/read",
        {
          method:
            "POST",
          body: {
            all: true,
          },
        }
      );

      await refreshData();
      renderNotifications();
    } catch (e) {
      toast(
        humanizeError(e),
        "error"
      );
    }
  };

  card.append(all);
  root.append(card);
}

function notificationTitle(n) {
  switch (n.type) {
    case "friend_request":
      return "New friend request";

    case "friend_request_accepted":
      return "Friend request accepted";

    case "challenge":
      return "New challenge";

    case "challenge_response":
      return "Challenge update";

    case "new_follower":
      return "New follower";

    default:
      return "Account activity";
  }
}

function notificationText(n) {
  const p = n.payload || {};

  if (
    n.type ===
    "friend_request"
  ) {
    return `${
      p.fromUsername ||
      "A player"
    } sent you a friend request.`;
  }

  if (
    n.type ===
    "friend_request_accepted"
  ) {
    return `${
      p.fromUsername ||
      "A player"
    } accepted your request.`;
  }

  if (
    n.type ===
    "challenge"
  ) {
    return `${
      p.fromUsername ||
      "A player"
    } challenged you to ${
      p.timeControl || ""
    }.`;
  }

  if (
    n.type ===
    "challenge_response"
  ) {
    return `Your challenge was ${
      p.status || "updated"
    }.`;
  }

  if (
    n.type ===
    "new_follower"
  ) {
    return `${
      p.fromUsername ||
      "A player"
    } followed you.`;
  }

  return "Account activity.";
}

function renderPlayerProfile(
  username
) {
  clearContent();

  const root = $("#content");

  root.append(
    pageHead(
      `@${username}`,
      "Public player profile.",
      [
        h("a", {
          class:
            "secondary-btn",
          href:
            "#friends",
          text:
            "Back to players",
        }),
      ]
    )
  );

  const loading = h("div", {
    class: "card",
  }, [
    h("p", {
      class: "muted",
      text:
        "Loading profile…",
    }),
  ]);

  root.append(loading);

  api(
    `/profile/${encodeURIComponent(
      username
    )}`
  ).then(d => {
    root.replaceChildren();

    const u = d.user;

    const hero = h(
      "section",
      {
        class:
          "card profile-hero public-profile",
      }
    );

    hero.append(
      h("div", {
        class:
          "profile-avatar-wrap",
      }, [
        userAvatar(
          u,
          "profile-avatar"
        ),
      ])
    );

    const identity = h("div", {
      class:
        "profile-identity",
    });

    identity.append(
      h("h2", {
        text:
          u.displayName ||
          u.username,
      }),
      h("div", {
        class: "handle",
        text:
          `@${u.username}`,
      }),
      h("p", {
        class:
          "profile-about",
        text:
          u.about ||
          "No public bio.",
      }),
      h("small", {
        class:
          "muted",
        text:
          `Joined ${safeDate(
            u.createdAt
          )} · ${
            d.social?.friends ||
            0
          } friends · ${
            d.social?.followers ||
            0
          } followers · ${
            d.social?.following ||
            0
          } following`,
      })
    );

    hero.append(identity);

    const actions = h(
      "div",
      {
        class:
          "profile-actions public-actions",
      }
    );

    if (
      u.id !== state.me.id
    ) {
      actions.append(
        h("button", {
          class:
            "secondary-btn",
          text:
            "Add friend",
          onclick: () =>
            sendFriendRequest(
              u.id
            ),
        }),
        h("button", {
          class:
            "secondary-btn",
          text:
            "Follow",
          onclick: () =>
            followUser(
              u.id
            ),
        }),
        h("button", {
          class:
            "secondary-btn",
          text:
            "Challenge",
          onclick: () =>
            openChallenge(u),
        }),
        h("button", {
          class:
            "secondary-btn",
          text:
            "Block",
          onclick: () =>
            blockUser(
              u.id,
              u.username
            ),
        }),
        h("button", {
          class:
            "secondary-btn",
          text:
            "Report",
          onclick: () =>
            reportUser(
              u.id,
              u.username
            ),
        })
      );
    }

    hero.append(actions);
    root.append(hero);

    const ratings = h("div", {
      class:
        "rating-grid",
    });

    d.ratings
      .filter(
        r =>
          r.category !==
          "puzzle"
      )
      .forEach(r =>
        ratings.append(
          ratingCard(r)
        )
      );

    if (
      d.puzzle?.rating != null
    ) {
      ratings.append(
        h("div", {
          class:
            "rating-card",
        }, [
          h("div", {
            class: "label",
            text:
              "Puzzle",
          }),
          h("strong", {
            text:
              formatRating(
                d.puzzle
                  .rating
              ),
          }),
          h("span", {
            class:
              "rating-status",
            text:
              "Puzzles",
          }),
        ])
      );
    }

    root.append(
      sectionCard(
        "Ratings",
        ratings
      ),
      sectionCard(
        "Summary",
        h("div", {
          class:
            "stats-line",
        }, [
          h("span", {
            text:
              `${d.summary?.games || 0} games`,
          }),
          h("span", {
            text:
              `${d.summary?.wins || 0} wins`,
          }),
          h("span", {
            text:
              `${d.summary?.draws || 0} draws`,
          }),
          h("span", {
            text:
              `${d.summary?.losses || 0} losses`,
          }),
        ])
      )
    );
  }).catch(e => {
    loading.replaceChildren(
      h("p", {
        class: "muted",
        text:
          humanizeError(e),
      })
    );
  });
}

function googleStart(
  mode = "login"
) {
  location.href =
    `/api/account/google/start${
      mode === "link"
        ? "?mode=link"
        : ""
    }`;
}

function validateUsernameClient(
  value
) {
  const v =
    String(value || "");

  return (
    /^[A-Za-z0-9_-]{3,20}$/.test(
      v
    ) &&
    !/^\d+$/.test(v)
  );
}

function mountHeader() {
  $$("[data-auth-tab]")
    .forEach(button =>
      button.addEventListener(
        "click",
        () =>
          setAuthMode(
            button.dataset
              .authTab
          )
      )
    );

  $$(
    "[data-toggle-password]"
  ).forEach(button =>
    button.addEventListener(
      "click",
      () => {
        const input =
          document.getElementById(
            button.dataset
              .togglePassword
          );

        input.type =
          input.type ===
          "password"
            ? "text"
            : "password";

        button.textContent =
          input.type ===
          "password"
            ? "Show"
            : "Hide";
      }
    )
  );

  $("#googleLogin").onclick =
    () =>
      googleStart("login");

  $("#googleSignup").onclick =
    () =>
      googleStart("signup");

  $("#guestLogin").onclick =
    async () => {
      const button =
        $("#guestLogin");

      button.disabled = true;
      button.textContent =
        "Starting guest mode…";

      try {
        const d =
          await api(
            "/guest",
            {
              method:
                "POST",
              body: {},
            }
          );

        const username =
          d?.guest
            ?.username ||
          d?.guest
            ?.label ||
          "Guest";

        try {
          sessionStorage.setItem(
            "advancedChessGuestUsername",
            username
          );
        } catch {}

        location.replace(
          "/chess.html"
        );
      } catch (e) {
        button.disabled =
          false;

        button.textContent =
          "Continue as Guest";

        toast(
          humanizeError(e),
          "error"
        );
      }
    };

  $("#loginForm").onsubmit =
    async e => {
      e.preventDefault();

      const err =
        $("#loginError");

      err.textContent = "";

      try {
        const d =
          await api(
            "/login",
            {
              method:
                "POST",
              body: {
                email:
                  $("#loginEmail")
                    .value,
                password:
                  $("#loginPassword")
                    .value,
              },
            }
          );

        if (
          d.requires2FA
        ) {
          openMFALogin();
          return;
        }

        location.replace(
          "/chess.html"
        );
      } catch (x) {
        err.textContent =
          x.message ===
          "invalid_credentials"
            ? "Email or password is incorrect."
            : humanizeError(x);
      }
    };

  $$(
    'a[href="#forgot-password"]'
  ).forEach(a =>
    a.addEventListener(
      "click",
      e => {
        e.preventDefault();
        openForgotPassword();
      }
    )
  );

  $("#signupForm").onsubmit =
    async e => {
      e.preventDefault();

      const err =
        $("#signupError");

      err.textContent = "";

      if (
        $("#signupPassword")
          .value !==
        $("#signupPassword2")
          .value
      ) {
        err.textContent =
          "Passwords do not match.";
        return;
      }

      try {
        await api(
          "/signup",
          {
            method:
              "POST",
            body: {
              username:
                $("#signupUsername")
                  .value,
              email:
                $("#signupEmail")
                  .value,
              password:
                $("#signupPassword")
                  .value,
            },
          }
        );

        location.replace(
          "/chess.html"
        );
      } catch (x) {
        err.textContent =
          humanizeError(x);
      }
    };

  let usernameTimer = null;
  let usernameAvailable =
    false;

  $("#signupUsername")
    .addEventListener(
      "input",
      () => {
        clearTimeout(
          usernameTimer
        );

        usernameAvailable =
          false;

        const value =
          $("#signupUsername")
            .value;

        const out =
          $("#usernameCheck");

        out.textContent = "";
        out.className = "";

        if (
          !validateUsernameClient(
            value
          )
        ) {
          return;
        }

        usernameTimer =
          setTimeout(
            async () => {
              try {
                const d =
                  await api(
                    `/username/check?username=${encodeURIComponent(
                      value
                    )}`
                  );

                usernameAvailable =
                  !!d.available;

                out.textContent =
                  d.available
                    ? "Available"
                    : d.reason ||
                      "Unavailable";

                out.className =
                  d.available
                    ? "ok"
                    : "bad";
              } catch {
                out.textContent =
                  "";
              }
            },
            300
          );
      }
    );

  $("#sideSignout").onclick =
    async () => {
      try {
        await api(
          "/logout",
          {
            method:
              "POST",
            body: {},
          }
        );
      } catch (e) {
        toast(
          humanizeError(e),
          "error"
        );
      }

      state.me = null;
      state.guest = null;
      state.csrf = null;

      showAuth();
      setAuthMode("login");

      location.hash = "";
    };

  $("#notifBtn").onclick =
    async () => {
      if (!state.me) {
        return setAuthMode(
          "login"
        );
      }

      await refreshData();

      location.hash =
        "#notifications";

      renderRoute();
    };

  $("#profileMenuBtn").onclick =
    () => {
      const menu =
        $("#profileMenu");

      menu.hidden =
        !menu.hidden;

      $("#profileMenuBtn")
        .setAttribute(
          "aria-expanded",
          String(
            !menu.hidden
          )
        );
    };

  $("#menuSignout").onclick =
    () =>
      $("#sideSignout").click();

  document.addEventListener(
    "click",
    e => {
      const wrap =
        document.querySelector(
          ".user-menu-wrap"
        );

      if (
        wrap &&
        !wrap.contains(
          e.target
        )
      ) {
        const menu =
          $("#profileMenu");

        menu.hidden = true;

        $("#profileMenuBtn")
          .setAttribute(
            "aria-expanded",
            "false"
          );
      }
    }
  );

  $$("[data-route]")
    .forEach(link =>
      link.addEventListener(
        "click",
        e => {
          e.preventDefault();

          const href =
            link.getAttribute(
              "href"
            ) ||
            "#profile";

          if (
            location.hash !==
            href
          ) {
            location.hash =
              href;
          }

          renderRoute();
        }
      )
    );

  window.addEventListener(
    "hashchange",
    () => {
      if (
        location.hash ===
        "#create-account"
      ) {
        showAuth();
        setAuthMode(
          "signup"
        );
        return;
      }

      if (
        location.hash ===
        "#sign-in"
      ) {
        showAuth();
        setAuthMode(
          "login"
        );
        return;
      }

      renderRoute();
    }
  );

  window.addEventListener(
    "popstate",
    () => {
      if (
        location.hash ===
        "#create-account"
      ) {
        showAuth();
        setAuthMode(
          "signup"
        );
        return;
      }

      if (
        location.hash ===
        "#sign-in"
      ) {
        showAuth();
        setAuthMode(
          "login"
        );
        return;
      }

      renderRoute();
    }
  );

  $("#modal").addEventListener(
    "click",
    e => {
      if (
        e.target.id ===
        "modal"
      ) {
        e.currentTarget.hidden =
          true;
      }
    }
  );
}

function openForgotPassword() {
  const m = $("#modal");

  m.hidden = false;
  m.replaceChildren();

  const c = h("div", {
    class:
      "modal-card",
  });

  c.append(
    h("h3", {
      text:
        "Reset your password",
    }),
    h("p", {
      class: "muted",
      text:
        "Enter your account email. The response is intentionally the same whether or not the address exists.",
    })
  );

  const field = h("label", {
    class: "field",
  }, ["Email"]);

  const input = h("input", {
    type: "email",
    autocomplete: "email",
  });

  field.append(input);
  c.append(field);

  const actions = h(
    "div",
    {
      class:
        "modal-actions",
    }
  );

  const close = h("button", {
    class:
      "secondary-btn",
    text:
      "Cancel",
  });

  const send = h("button", {
    class:
      "primary-btn",
    text:
      "Send reset link",
  });

  close.onclick = () =>
    (m.hidden = true);

  send.onclick =
    async () => {
      try {
        await api(
          "/forgot-password",
          {
            method:
              "POST",
            body: {
              email:
                input.value,
            },
          }
        );

        m.hidden = true;

        toast(
          "If the account exists, a reset link has been sent.",
          "success"
        );
      } catch {
        toast(
          "Unable to process the request.",
          "error"
        );
      }
    };

  actions.append(
    close,
    send
  );

  c.append(actions);
  m.append(c);
  input.focus();
}

function openMFALogin() {
  const m = $("#modal");

  m.hidden = false;
  m.replaceChildren();

  const c = h("div", {
    class:
      "modal-card",
  });

  c.append(
    h("h3", {
      text:
        "Two-factor authentication",
    }),
    h("p", {
      class: "muted",
      text:
        "Use your authenticator code or a one-time backup code.",
    })
  );

  const input = h("input", {
    inputMode: "numeric",
    autocomplete:
      "one-time-code",
    placeholder:
      "Authentication code",
  });

  c.append(input);

  const a = h("div", {
    class:
      "modal-actions",
  });

  const cancel = h("button", {
    class:
      "secondary-btn",
    text: "Cancel",
  });

  const okb = h("button", {
    class:
      "primary-btn",
    text: "Verify",
  });

  cancel.onclick = () =>
    (m.hidden = true);

  okb.onclick = async () => {
    try {
      await api(
        "/login/2fa",
        {
          method:
            "POST",
          body: {
            code:
              input.value,
          },
        }
      );

      m.hidden = true;

      location.replace(
        "/chess.html"
      );
    } catch (e) {
      toast(
        humanizeError(e),
        "error"
      );
    }
  };

  a.append(
    cancel,
    okb
  );

  c.append(a);
  m.append(c);

  input.focus();
}

function openPasswordReset(
  token
) {
  $("#authView").hidden =
    false;

  $("#accountView").hidden =
    true;

  $("#guestView").hidden =
    true;

  setAuthMode("login");

  const pane =
    $("#loginPane");

  pane.innerHTML = "";

  const title = h("h2", {
    text:
      "Choose a new password",
  });

  const p = h("p", {
    class: "muted",
    text:
      "Use a strong password. This reset link expires after a short period.",
  });

  const form =
    h("form");

  const a = h("label", {
    class: "field",
  }, [
    "New password",
  ]);

  const ai = h("input", {
    id:
      "resetPassword",
    type:
      "password",
    autocomplete:
      "new-password",
    required:
      true,
  });

  a.append(ai);

  const b = h("label", {
    class: "field",
  }, [
    "Confirm password",
  ]);

  const bi = h("input", {
    id:
      "resetPassword2",
    type:
      "password",
    autocomplete:
      "new-password",
    required:
      true,
  });

  b.append(bi);

  const err = h("span", {
    class:
      "form-error",
  });

  const submit = h(
    "button",
    {
      class:
        "primary-btn full",
      type:
        "submit",
      text:
        "Set new password",
    }
  );

  form.append(
    a,
    b,
    err,
    submit
  );

  pane.append(
    title,
    p,
    form
  );

  form.onsubmit =
    async e => {
      e.preventDefault();

      if (
        ai.value !==
        bi.value
      ) {
        err.textContent =
          "Passwords do not match.";
        return;
      }

      try {
        await api(
          "/reset-password",
          {
            method:
              "POST",
            body: {
              token,
              password:
                ai.value,
            },
          }
        );

        toast(
          "Password updated. Please sign in.",
          "success"
        );

        location.hash = "";
        setAuthMode(
          "login"
        );
      } catch (x) {
        err.textContent =
          humanizeError(x);
      }
    };

  ai.focus();
}

async function boot() {
  mountHeader();

  if (
    location.hash ===
    "#create-account"
  ) {
    showAuth();
    setAuthMode("signup");
  }

  if (
    location.hash.startsWith(
      "#reset-password?token="
    )
  ) {
    const token =
      new URLSearchParams(
        location.hash.slice(
          location.hash.indexOf("?") +
            1
        )
      ).get("token");

    if (token) {
      openPasswordReset(
        token
      );
    }

    return;
  }

  if (
    location.hash.startsWith(
      "#google-complete?token="
    )
  ) {
    setAuthMode("signup");

    $("#authView").hidden =
      false;

    $("#accountView").hidden =
      true;

    $("#guestView").hidden =
      true;

    const token =
      new URLSearchParams(
        location.hash.slice(
          location.hash.indexOf("?") +
            1
        )
      ).get("token");

    const pane =
      $("#signupPane");

    pane.innerHTML = "";

    const title = h("h2", {
      text:
        "Choose your username",
    });

    const p = h("p", {
      class: "muted",
      text:
        "One last step. Choose the unique username other players will see.",
    });

    const form =
      h("form");

    const field = h("label", {
      class: "field",
    }, ["Username"]);

    const input = h("input", {
      id:
        "googleUsername",
      maxlength:
        "20",
      autocomplete:
        "username",
      required:
        true,
    });

    field.append(input);

    const err = h("span", {
      class:
        "form-error",
    });

    const submit = h(
      "button",
      {
        class:
          "primary-btn full",
        type:
          "submit",
        text:
          "Finish account",
      }
    );

    form.append(
      field,
      err,
      submit
    );

    pane.append(
      title,
      p,
      form
    );

    form.onsubmit =
      async e => {
        e.preventDefault();

        try {
          await api(
            "/google/complete",
            {
              method:
                "POST",
              body: {
                token,
                username:
                  input.value,
              },
            }
          );

          location.replace(
            "/chess.html"
          );
        } catch (x) {
          err.textContent =
            humanizeError(x);
        }
      };

    return;
  }

  if (
    location.hash.startsWith(
      "#verify-email-change?token="
    )
  ) {
    const token =
      new URLSearchParams(
        location.hash.split("?")[1]
      ).get("token");

    if (token) {
      try {
        await api(
          "/verify-email-change",
          {
            method:
              "POST",
            body: {
              token,
            },
          }
        );

        toast(
          "Email updated. Please sign in again.",
          "success"
        );
      } catch (e) {
        toast(
          humanizeError(e),
          "error"
        );
      }
    }

    return;
  }

  if (
    location.hash.startsWith(
      "#verify-email?token="
    )
  ) {
    const token =
      new URLSearchParams(
        location.hash.split("?")[1]
      ).get("token");

    if (token) {
      try {
        await api(
          "/verify-email",
          {
            method:
              "POST",
            body: {
              token,
            },
          }
        );

        toast(
          "Email verified.",
          "success"
        );
      } catch (e) {
        toast(
          humanizeError(e),
          "error"
        );
      }
    }

    location.hash =
      "#profile";
  }

  try {
    await refreshData();
    renderRoute();
  } catch {
    setView("auth");
    setAuthMode("login");
  }

  state.booted = true;
}

boot();
