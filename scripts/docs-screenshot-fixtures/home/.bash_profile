# .bash_profile — honeymux docs screenshot fixture.
#
# tmux spawns bash as a login shell by default. Login bash reads
# .bash_profile (not .bashrc), so source .bashrc from here so the
# PS1 set there applies inside tmux panes.

if [ -f ~/.bashrc ]; then
    . ~/.bashrc
fi
