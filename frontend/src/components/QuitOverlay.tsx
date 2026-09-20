type QuitOverlayProps = {
  message: string;
};

/** Full-screen notice shown after the Quit action fires. */
function QuitOverlay({ message }: QuitOverlayProps) {
  return (
    <div className="quit-overlay">
      <div className="quit-card">
        <span className="quit-spinner" aria-hidden="true" />
        <h2>Shutting down</h2>
        <p>{message}</p>
      </div>
    </div>
  );
}

export default QuitOverlay;
