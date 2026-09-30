const API = "/api/account";
const DEFAULT_AVATAR = "/account/default-avatar.svg";

const css = `
.ac-account-root{
    position:relative;
    flex:none;
    min-width:0;
    z-index:1000;
    font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
}

.ac-account-button{
    display:flex;
    align-items:center;
    gap:10px;
    width:190px;
    min-width:190px;
    box-sizing:border-box;
    padding:6px 10px 6px 7px;
    border:1px solid rgba(255,255,255,.13);
    border-radius:999px;
    background:rgba(18,22,29,.96);
    color:#eef2f7;
    box-shadow:0 8px 24px rgba(0,0,0,.25);
    cursor:pointer;
    backdrop-filter:blur(10px);
}

.ac-account-button:hover{
    background:rgba(27,33,42,.98);
}

.ac-account-avatar{
    width:30px;
    height:30px;
    border-radius:50%;
    object-fit:cover;
    background:#11161d;
    flex:none;
}

.ac-account-text{
    min-width:0;
    flex:1 1 auto;
    display:grid;
    grid-template-columns:minmax(0,1fr);
    grid-template-rows:auto auto;
    row-gap:5px;
    align-items:start;
    justify-content:center;
    text-align:left;
}

.ac-account-name{
    display:block;
    min-width:0;
    width:100%;
    overflow:hidden;
    text-overflow:ellipsis;
    white-space:nowrap;
    font-size:12px;
    line-height:1.2;
    font-weight:850;
}

.ac-account-kind{
    display:block;
    margin:0;
    font-size:10px;
    line-height:1.1;
    font-weight:700;
    color:#9ea8b5;
}

.ac-account-chevron{
    flex:none;
    font-size:12px;
    color:#8e99a7;
}

.ac-account-menu{
    position:absolute;
    top:calc(100% + 8px);
    right:0;
    width:220px;
    padding:8px;
    box-sizing:border-box;
    border:1px solid rgba(255,255,255,.11);
    border-radius:14px;
    background:rgba(18,22,29,.98);
    box-shadow:0 18px 50px rgba(0,0,0,.42);
}

.ac-account-menu[hidden]{
    display:none;
}

.ac-account-menu-head{
    display:flex;
    gap:10px;
    padding:10px;
    border-bottom:1px solid rgba(255,255,255,.08);
    margin-bottom:6px;
}

.ac-account-menu-head img{
    width:30px;
    height:30px;
    border-radius:50%;
    object-fit:cover;
    flex:none;
}

.ac-account-menu-head strong{
    display:block;
    font-size:12px;
    color:#eef2f7;
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
    cursor:pointer;
    box-sizing:border-box;
}

.ac-account-menu a:hover,
.ac-account-menu button:hover{
    background:#222a34;
}

.ac-account-menu .ac-muted{
    margin-top:3px;
    color:#96a0ae;
    font-size:10px;
    font-weight:700;
}

.ac-account-menu .ac-divider{
    height:1px;
    background:rgba(255,255,255,.08);
    margin:6px 0;
}

.home-top-actions{
    display:flex !important;
    align-items:center !important;
    justify-content:flex-end !important;
    gap:8px !important;
}

@media(max-width:720px){
    .home-top-actions{
        display:grid !important;
        grid-template-columns:auto auto;
        grid-template-rows:auto auto;
        align-items:center !important;
        justify-content:end !important;
        gap:6px !important;
    }

    .home-top-actions .ac-account-root{
        grid-column:1 / -1;
        grid-row:1;
        justify-self:end;
        margin-bottom:2px;
    }

    .home-top-actions .home-top-action{
        grid-row:2;
    }

    .home-top-actions .home-top-action:first-child{
        grid-column:1;
    }

    .home-top-actions .home-top-action:nth-child(2){
        grid-column:2;
    }

    .ac-account-button{
        width:178px;
        min-width:178px;
    }

    .ac-account-name{
        max-width:105px;
    }

    .ac-account-menu{
        width:205px;
    }
}
`;

function ensureStyles() {
    if (document.getElementById("ac-account-styles")) return;

    const style = document.createElement("style");
    style.id = "ac-account-styles";
    style.textContent = css;
    document.head.appendChild(style);
}

async function getMe() {
    const response = await fetch(`${API}/me`, {
        credentials: "same-origin",
        cache: "no-store"
    });

    let data = {};

    try {
        data = await response.json();
    } catch {}

    if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
    }

    return data;
}

function accountHref(hash) {
    return `/account/index.html${hash || ""}`;
}

function makeButton(label, kind, avatar) {
    const root = document.createElement("div");
    root.className = "ac-account-root";

    const button = document.createElement("button");
    button.className = "ac-account-button";
    button.type = "button";
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");

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

    const name = document.createElement("span");
    name.className = "ac-account-name";
    name.textContent = label;

    const type = document.createElement("span");
    type.className = "ac-account-kind";
    type.textContent = kind;

    text.append(name, type);

    const chevron = document.createElement("span");
    chevron.className = "ac-account-chevron";
    chevron.textContent = "⌄";

    button.append(img, text, chevron);

    const menu = document.createElement("div");
    menu.className = "ac-account-menu";
    menu.hidden = true;
    menu.setAttribute("role", "menu");

    const head = document.createElement("div");
    head.className = "ac-account-menu-head";

    const headImg = document.createElement("img");
    headImg.src = avatar || DEFAULT_AVATAR;
    headImg.alt = "";

    const headText = document.createElement("div");

    const headName = document.createElement("strong");
    headName.textContent = label;

    const headType = document.createElement("div");
    headType.className = "ac-muted";
    headType.textContent = kind;

    headText.append(headName, headType);
    head.append(headImg, headText);
    menu.append(head);

    const addLink = (textValue, hash) => {
        const link = document.createElement("a");
        link.href = accountHref(hash);
        link.textContent = textValue;
        link.setAttribute("role", "menuitem");
        menu.append(link);
    };

    addLink("Profile", "#profile");
    addLink("Game history", "#games");
    addLink("Stats", "#stats");
    addLink("Settings", "#settings");

    const divider = document.createElement("div");
    divider.className = "ac-divider";
    menu.append(divider);

    addLink("Create account", "#create-account");
    addLink("Sign in", "#sign-in");

    button.addEventListener("click", event => {
        event.stopPropagation();

        menu.hidden = !menu.hidden;
        button.setAttribute(
            "aria-expanded",
            String(!menu.hidden)
        );
    });

    document.addEventListener("click", event => {
        if (!root.contains(event.target)) {
            menu.hidden = true;
            button.setAttribute("aria-expanded", "false");
        }
    });

    root.append(button, menu);

    // Put the account control INSIDE the existing top-right action group.
    // This prevents it from floating over the notification/settings buttons.
    const topActions = document.querySelector(".home-top-actions");

    if (topActions) {
        topActions.appendChild(root);
    } else {
        document.body.appendChild(root);
    }
}

async function boot() {
    ensureStyles();

    try {
        const data = await getMe();

        if (data?.authenticated && data.user) {
            makeButton(
                data.user.username,
                "Player",
                data.user.avatarUrl || DEFAULT_AVATAR
            );
            return;
        }

        if (data?.guest && data.guestProfile) {
            makeButton(
                data.guestProfile.username ||
                    data.guestProfile.label ||
                    "Guest",
                "Guest",
                data.guestProfile.avatarUrl ||
                    DEFAULT_AVATAR
            );
            return;
        }

        makeButton("Account", "Sign in", DEFAULT_AVATAR);

    } catch (error) {
        console.warn("Account UI failed to load:", error);
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
} else {
    boot();
}
