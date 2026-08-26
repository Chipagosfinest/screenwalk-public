import "./style.css";

type Screen = { eyebrow: string; title: string; body: string; links: Array<[string, string]> };

const screens: Record<string, Screen> = {
  "/": { eyebrow: "Client-rendered SPA", title: "Projects, without the mystery.", body: "This product is rendered entirely in the browser and changes routes without reloading the document.", links: [["/projects", "Open projects"], ["/settings", "Review settings"]] },
  "/projects": { eyebrow: "Project index", title: "Three active ideas.", body: "The primary journey continues into a creation screen.", links: [["/projects/new", "Create project"], ["/", "Back home"]] },
  "/projects/new": { eyebrow: "New project", title: "Start with a clear outcome.", body: "This is a concrete leaf in the client-side flow.", links: [["/projects", "Cancel"], ["/", "Finish later"]] },
  "/settings": { eyebrow: "Settings", title: "A separate product branch.", body: "A visitor can reach this branch directly from the entry screen.", links: [["/", "Done"]] },
};

function render() {
  const screen = screens[location.pathname] ?? { eyebrow: "Missing route", title: "Nothing here yet.", body: "This client route is not defined.", links: [["/", "Go home"]] };
  document.title = `Threadline — ${screen.title}`;
  document.querySelector<HTMLDivElement>("#app")!.innerHTML = `<main><div class="eyebrow">${screen.eyebrow}</div><h1>${screen.title}</h1><p>${screen.body}</p><nav>${screen.links.map(([href, label]) => `<a href="${href}" data-route>${label}</a>`).join("")}</nav></main>`;
}

document.addEventListener("click", (event) => {
  const link = (event.target as Element).closest<HTMLAnchorElement>("a[data-route]");
  if (!link) return;
  event.preventDefault();
  history.pushState({}, "", link.href);
  render();
});
window.addEventListener("popstate", render);
render();
