# @arrows-code/messages

Host-agnostic wire contract between the arrows embed bundle and the editors that
host it (VS Code and IntelliJ/JCEF). One definition of the postMessage
envelopes both directions, plus `parseInboundMessage` — the validated boundary
for untrusted embed→host messages.

No editor-platform dependency. A new host reimplements only its transport; the
message shapes and validation come from here.
