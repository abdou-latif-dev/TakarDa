// This tab is never actually shown — BottomTabBar intercepts its press and
// pushes /modals/create-menu instead of navigating here. The route still
// needs to exist so the Tabs navigator has something to register.
export default function CreatePlaceholder() {
  return null;
}
