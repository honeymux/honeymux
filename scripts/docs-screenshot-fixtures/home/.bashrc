# .bashrc — honeymux docs screenshot fixture.
#
# Pure-bash approximation of the catppuccin-powerline starship preset.
# Rounded caps bookend the segment chain; interior transitions use
# triangular separators. Path, branch, and time are mocked so shots
# render identically on any checkout.

if [ -f /etc/bashrc ]; then
    . /etc/bashrc
fi

PS1='\n\[\e[38;2;243;139;168m\]\[\e[1;38;2;30;30;46;48;2;243;139;168m\] 󰣛 aaron \[\e[38;2;243;139;168;48;2;250;179;135m\]\[\e[1;38;2;30;30;46;48;2;250;179;135m\] …/honeymux \[\e[38;2;250;179;135;48;2;249;226;175m\]\[\e[1;38;2;30;30;46;48;2;249;226;175m\]  main \[\e[38;2;249;226;175;48;2;166;227;161m\]\[\e[1;38;2;30;30;46;48;2;166;227;161m\] $ \[\e[38;2;166;227;161;48;2;148;226;213m\]\[\e[1;38;2;30;30;46;48;2;148;226;213m\]  13:37 \[\e[0m\]\[\e[38;2;148;226;213m\]\[\e[0m\] \[\e[38;2;203;166;247m\]❯\[\e[0m\] '

unset PROMPT_COMMAND
