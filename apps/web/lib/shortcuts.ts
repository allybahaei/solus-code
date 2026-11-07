/** Every shortcut, for the shortcut sheet. The keys themselves live in useKeyboard. */
export const SHORTCUTS: { group: string; items: { keys: string[]; label: string }[] }[] = [
  {
    group: "Anywhere",
    items: [
      { keys: ["⌘", "K"], label: "Command palette" },
      { keys: ["⌘", "B"], label: "Show or hide the sidebar" },
      { keys: ["⌘", ","], label: "Settings" },
      { keys: ["?"], label: "This list" },
      { keys: ["N"], label: "New task" },
      { keys: ["/"], label: "Search workspaces" },
    ],
  },
  {
    group: "Moving around",
    items: [
      { keys: ["J"], label: "Next workspace, or next file in review" },
      { keys: ["K"], label: "Previous workspace, or previous file in review" },
      { keys: ["]"], label: "Next chat tab" },
      { keys: ["["], label: "Previous chat tab" },
      { keys: ["X"], label: "Close the chat tab" },
      { keys: ["Enter"], label: "Go to the reply box" },
      { keys: ["Esc"], label: "Back to the chat" },
    ],
  },
  {
    group: "The open task",
    items: [
      { keys: ["S"], label: "Start" },
      { keys: ["O"], label: "Open in your editor" },
      { keys: ["T"], label: "Give the terminal the whole window" },
      { keys: ["R"], label: "Review the diff" },
      { keys: ["M"], label: "Merge" },
      { keys: ["P"], label: "Open a pull request" },
    ],
  },
  {
    group: "In review",
    items: [
      { keys: ["V"], label: "Mark the file viewed" },
      { keys: ["."], label: "Next comment" },
      { keys: [","], label: "Previous comment" },
      { keys: ["C"], label: "Write an overall comment" },
    ],
  },
];
