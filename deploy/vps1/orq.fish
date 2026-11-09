# orq on VPS1: every orq command (and the plugin's orq mcp) goes to orq serve on VPS2.
# Installed by deploy/bootstrap/vps1.sh to ~orq/.config/fish/conf.d/orq.fish.
set -gx ORQ_SERVER http://orq-server:7400
