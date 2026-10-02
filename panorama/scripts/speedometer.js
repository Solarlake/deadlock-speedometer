(() => {
    // tick scheduling
    let tickHandler = null;
    const TICK_INTERVAL = 0.015625; // seconds between updates (64 ticks per second)

    // UI element IDs and classes
    const GAMEPLAY_HUD_ID = "gameplay_hud";
    const SPEEDOMETER_LABEL_ID = "MovementSpeedLabel";
    const SPEEDOMETER_CURRENT_ID = "MovementSpeedCurrent";
    let root = null;
    let gameplayHUD = null;
    let speedometerLabel = null;
    let speedometerCurrent = null;

    // units
    let unit = 0;
    const upm = 39.36; // 1 meter = 39.36 hammer units

    // speedometer colors
    const TEXT_COLORS = [
        { speed: 0,     color: [235, 235, 235] },
        { speed: 8.8,   color: [236, 232, 211] },
        { speed: 14.7,   color: [255, 157, 45] },
        { speed: 28,  color: [255, 27, 53] },
    ];

    function boot() {
        root = _findRoot($.GetContextPanel());
        if (!root) return $.Schedule(0.5, boot);

        gameplayHUD = root.FindChildTraverse(GAMEPLAY_HUD_ID);
        if (!gameplayHUD) return $.Schedule(0.5, boot);

        speedometerLabel = root.FindChildTraverse(SPEEDOMETER_LABEL_ID);
        if (!speedometerLabel) return $.Schedule(0.5, boot);

        speedometerCurrent = root.FindChildTraverse(SPEEDOMETER_CURRENT_ID);
        if (!speedometerCurrent) return $.Schedule(0.5, boot);

        speedometerCurrent.SetPanelEvent("onactivate", () => {
            unit = (unit + 1) % 4;
        });

        scheduleTick();
    }

    function scheduleTick() {
        if (tickHandler) $.CancelScheduled(tickHandler);
        tickHandler = $.Schedule(TICK_INTERVAL, tick);
    }

    function tick() {
        if (!root) root = _findRoot($.GetContextPanel());
        update();
        scheduleTick();
    }

    function update() {
        const speed = parseFloat(speedometerLabel.text.slice(0, -1));
        if (!isFinite(speed)) return; // don't update if speed is invalid
        
        let r, g, b;
        if (speed <= TEXT_COLORS[0].speed) {
            [r, g, b] = TEXT_COLORS[0].color;
        }
        else if (speed >= TEXT_COLORS[TEXT_COLORS.length - 1].speed) {
            [r, g, b] = TEXT_COLORS[TEXT_COLORS.length - 1].color;
        }
        else {
            for (let i = 0; i < TEXT_COLORS.length - 1; i++) {
                const a = TEXT_COLORS[i];
                const c = TEXT_COLORS[i + 1];
                if (speed <= c.speed) {
                    const frac = (speed - a.speed) / (c.speed - a.speed);
                    r = a.color[0] + (c.color[0] - a.color[0]) * frac;
                    g = a.color[1] + (c.color[1] - a.color[1]) * frac;
                    b = a.color[2] + (c.color[2] - a.color[2]) * frac;
                    break;
                }
            }
        }
        
        speedometerCurrent.style.x = gameplayHUD.actuallayoutheight <= 1080 ? "1px" : "0px"; // fix centering on 1080p and lower resolutions
        
        switch (unit) {
            case 0:
                speedometerCurrent.text = `${speed.toFixed(1)}m`; // m/s with unit
                break;
            case 1:
                speedometerCurrent.text = `${speed.toFixed(1)}`; // m/s no unit
                break;
            case 2:
                speedometerCurrent.text = `${(Math.round(speed * upm))}u`; // hammer units with unit
                break;
            case 3:
                speedometerCurrent.text = `${(Math.round(speed * upm))}`; // hammer units no unit
                break;
        }

        const toHex = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
        speedometerCurrent.style.color = `#${toHex(r)}${toHex(g)}${toHex(b)}ff`;
        // speedometerCurrent.style.color = "#ebebebff";
    }

    function _findRoot(p) {
        while (p.GetParent && p.GetParent()) p = p.GetParent();
        return p;
    }

    boot();
})();
// $.Msg("");
