# @arrows-code/host-protocol

Host-agnostic wire contract between the arrows embed bundle and whatever editor
hosts it (VS Code today, IntelliJ/JCEF later). One definition of the postMessage
envelopes both directions, plus `parseInboundMessage` — the validated boundary
for untrusted embed→host messages.

No editor-platform dependency. A new host reimplements only its transport; the
message shapes and validation come from here.
