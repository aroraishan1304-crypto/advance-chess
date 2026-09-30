const API = "/api/account";
const DEFAULT_AVATAR = "/account/default-avatar.svg";

const css = `
.ac-account-root{
    position:fixed;
    top:12px;
    right:14px;
    z-index:99999;
    font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif
}

.ac-account-button{
    display:flex;
    align-items:center;
    gap:10px;
    min-width:190px;
    padding:7px 10px 7px 8px;
    border:1px solid rgba(255,255,255,.13);
    border-radius:999px;
    background:rgba(18,22,29,.94);
    color:#eef2f7;
    box-shadow:0 10px 30px rgba(0,0,0,.28);
    cursor:pointer;
    backdrop-filter:blur(10px)
}

.ac-account-button:hover{
    background:rgba(27,33,42,.97)
}

.ac-account-avatar{
    width:30px;
    height:30px;
    border-radius:50%;
    object-fit:cover;
    background:#11161d;
    flex:none
}

.ac-account-text{
    min-width:0;
    flex:1;
    display:flex;
    flex-direction:column;
    justify-content:center;
    align-items:flex-start
}

.ac-account-name{
    display:block;
    width:100%;
    font-size:12px;
    font-weight:850;
    line-height:1.25;
    overflow:hidden;
    text-overflow:ellipsis;
    white-space:nowrap
}

.ac-account-kind{
    display:block;
    margin-top:4px;
    font-size:10px;
    color:#9ea8b5;
    font-weight:700;
    line-height:1.1
}

.ac-account-chevron{
    font-size:12px;
    color:#8e99a7;
    flex:none
}

.ac-account-menu{
    position:absolute;
    right:0;
    top:50px;
    width:220px;
    padding:8px;
    border:1px solid rgba(255,255,255,.11);
    border-radius:14px;
    background:rgba(18,22,29,.98);
    box-shadow:0 18px 50px rgba(0,0,0,.42)
}

.ac-account-menu[hidden]{
    display:none
}

.ac-account-menu-head{
    display:flex;
    gap:10px;
    padding:10px;
    border-bottom:1px solid rgba(255,255,255,.08);
    margin-bottom:6px
}

.ac-account-menu a,
.ac-account-menu button{
    display:block;
    width:100%;
    padding:10px 11px;
    border:0;
    border-radius:9px;
    background:transparent;
    color:#e9edf3;
    text-decoration:none;
    text-align:left;
    font-size:12px;
    font-weight:700;
    cursor:pointer
}

.ac-account-menu a:hover,
.ac-account-menu button:hover{
    background:#222a34
}

.ac-account-menu .ac-muted{
    color:#96a0ae;
    font-size:10px;
    font-weight:700;
    margin-top:3px
}

.ac-account-menu .ac-divider{
    height:1px;
    background:rgba(255,255,255,.08);
    margin:6px 0
}

/* Keep the account strip from covering the existing top-right buttons. */
.home-topbar{
    padding-right:250px !important;
}

@media(max-width:720px){
    .ac-account-root{
        top:8px;
        right:8px
    }

    .ac-account-button{
        min-width:175px
    }

    .ac-account-name{
        max-width:115px
    }

    .ac-account-menu{
        width:205px
    }

    .home-topbar{
        padding-right:220px !important;
    }
}
`;

function ensureStyles() {
    if (document.getElementById("ac-account-styles")) return;

    const s = document.createElement("style");
    s.id = "ac-account-styles";
    s.textContent = css;
    document.head.appendChild(s);
}

function accountHref(hash) {
    return `/account/index.html${hash || ""}`;
}

async function getMe() {
    const r = await fetch(`${API}/me`, {
        credentials: "same-origin",
        cache: "no-store"
    });

    let d = {};

    try {
        d = await r.json();
    } catch {}

    if (!r.ok) {
        throw new Error(d.error || `HTTP ${r.status}`);
    }

    return d;
}

function makeButton(label, kind, avatar) {
    const root = document.createElement("div");
    root.className = "ac-account-root";

    const btn = document.createElement("button");
    btn.className = "ac-account-button";
    btn.type = "button";
    btn.setAttribute("aria-haspopup", "menu");
    btn.setAttribute("aria-expanded", "false");

    const img = document.createElement("img");
    img.className = "ac-account-avatar";
    img.src = avatar || DEFAULT_AVATAR;
    img.alt = "";

    img.onerror = () => {
        img.onerror = null;
        img.src = DEFAULT_AVATAR;
    };

    const text = document.createElement("span");
    text.className = "ac-account-text";
    text.innerHTML = `
        <span class="ac-account-name"></span>
        <span class="ac-account-kind"></span>
    `;

    text.querySelector(".ac-account-name").textContent = label;
    text.querySelector(".ac-account-kind").textContent = kind;

    const chev = document.createElement("span");
    chev.className = "ac-account-chevron";
    chev.textContent = "⌄";

    btn.append(img, text, chev);

    const menu = document.createElement("div");
    menu.className = "ac-account-menu";
    menu.hidden = true;
    menu.setAttribute("role", "menu");

    const head = document.createElement("div");
    head.className = "ac-account-menu-head";

    const htxt = document.createElement("div");

    const strong = document.createElement("strong");
    strong.textContent = label;

    const small = document.createElement("div");
    small.className = "ac-muted";
    small.textContent = kind;

    htxt.append(strong, small);
    head.append(img.cloneNode(true), htxt);
    menu.append(head);

    const addLink = (textValue, hash) => {
        const a = document.createElement("a");
        a.href = accountHref(hash);
        a.role = "menuitem";
        a.textContent = textValue;
        menu.append(a);
    };

    addLink("Profile", "#profile");
    addLink("Game history", "#games");
    addLink("Stats", "#stats");
    addLink("Settings", "#settings");

    const divider = document.createElement("div");
    divider.className = "ac-divider";
    menu.append(divider);

    const create = document.createElement("a");
    create.href = accountHref("#create-account");
    create.textContent = "Create account";
    menu.append(create);

    const sign = document.createElement("a");
    sign.href = accountHref("#sign-in");
    sign.textContent = "Sign in";
    menu.append(sign);

    btn.addEventListener("click", () => {
        menu.hidden = !menu.hidden;
        btn.setAttribute(
            "aria-expanded",
            String(!menu.hidden)
        );
    });

    document.addEventListener("click", e => {
        if (!root.contains(e.target)) {
            menu.hidden = true;
            btn.setAttribute("aria-expanded", "false");
        }
    });

    root.append(btn, menu);
    document.body.append(root);
}

(async function boot() {
    ensureStyles();

    try {
        const d = await getMe();

        if (d?.authenticated && d.user) {
            makeButton(
                d.user.username,
                "Player",
                d.user.avatarUrl || DEFAULT_AVATAR
            );
            return;
        }

        if (d?.guest && d.guestProfile) {
            makeButton(
                d.guestProfile.username ||
                    d.guestProfile.label ||
                    "Guest",
                "Guest",
                d.guestProfile.avatarUrl ||
                    DEFAULT_AVATAR
            );
            return;
        }

        const root = document.createElement("div");
        root.className = "ac-account-root";

        const a = document.createElement("a");
        a.href = accountHref("#sign-in");
        a.className = "ac-account-button";
        a.textContent = "Sign in";

        root.append(a);
        document.body.append(root);

    } catch (e) {
        console.warn("Account UI failed to load:", e);
    }
})();
