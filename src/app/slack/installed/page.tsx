const mainStyle = {
  display: "flex",
  flexDirection: "column" as const,
  alignItems: "center",
  justifyContent: "center",
  flex: 1,
  textAlign: "center" as const,
  padding: "2rem",
  gap: "0.5rem",
};

export default async function SlackInstalledPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const succeeded = status !== "error";

  return (
    <main style={mainStyle}>
      {succeeded ? (
        <>
          <h1>You&apos;re connected</h1>
          <p>ApproveFlow has been successfully connected to Slack.</p>
        </>
      ) : (
        <>
          <h1>Installation failed</h1>
          <p>ApproveFlow could not be connected to Slack. Please try again.</p>
        </>
      )}
    </main>
  );
}
