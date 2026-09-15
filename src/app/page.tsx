export default function Home() {
  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        flex: 1,
        textAlign: "center",
        padding: "2rem",
        gap: "0.5rem",
      }}
    >
      <h1>ApproveFlow</h1>
      <p>Request. Approve. Audit.</p>
      <p>All from Slack.</p>
      <a
        href="/api/slack/install"
        style={{
          marginTop: "1rem",
          padding: "0.6rem 1.2rem",
          borderRadius: "6px",
          background: "#4A154B",
          color: "#fff",
        }}
      >
        Add to Slack
      </a>
    </main>
  );
}
