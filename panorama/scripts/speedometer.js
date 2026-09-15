(() => {
    // tick scheduling
    let tickHandler = null;
    const TICK_INTERVAL = 0.015625; // seconds between updates (64 ticks per second)

    // UI element IDs and classes
    const GAMEPLAY_HUD_ID = "gameplay_hud";
    const SPEEDOMETER_LABEL_ID = "speedometerLabel";
    const MINIMAP_PIP_CLASS = "client_cone_fov";
    const MINIMAP_CLASS = "HudMinimapContainer";
    let root = null;
    let gameplayHUD = null;
    let speedometerLabel = null;
    let minimapPip = null;
    let minimap = null;

    // minimap position sampling
    let pos_samples = [];
    const MAX_SAMPLES = 7; // MAX_SAMPLES * TICK_INTERVAL == window time
    const TELEPORT_THRESHOLD = 0.15; // pip units per second, above which assume the player teleported and reset the sample window

    // speed smoothing parameters
    const SPEED_EMA_TAU_SEC = 0.11; // EMA time constant: larger = smoother but laggier
    const SPEED_DEADBAND_FRAC = 0.07; // fraction of current speed treated as noise, damped harder
    const SPEED_REST_THRESHOLD = 100; // speed below which to snap straight to rest instead of decaying
    let smoothedSpeed = null;
    let lastSpeedTimeMs = null;
    
    // speed conversion
    const PIP_TO_UNITS = 21500;

    // speedometer colors
    const TEXT_COLORS = [
        { speed: 0,     color: [235, 235, 235] },
        { speed: 346,   color: [236, 232, 211] },
        { speed: 546,   color: [255, 157, 45] },
        { speed: 1000,  color: [255, 27, 53] },
    ];

    function boot() {
        root = findRoot($.GetContextPanel());
        if (!root) return $.Schedule(0.5, boot);

        gameplayHUD = root.FindChildTraverse(GAMEPLAY_HUD_ID);
        if (!gameplayHUD) return $.Schedule(0.5, boot);

        speedometerLabel = root.FindChildTraverse(SPEEDOMETER_LABEL_ID);
        if (!speedometerLabel) return $.Schedule(0.5, boot);
        
        minimapPip = root.FindChildrenWithClassTraverse(MINIMAP_PIP_CLASS)[0];
        if (!minimapPip) return $.Schedule(0.5, boot);
        
        minimap = root.FindChildTraverse(MINIMAP_CLASS);
        if (!minimap) return $.Schedule(0.5, boot);

        scheduleTick();
    }

    function scheduleTick() {
        if (tickHandler) $.CancelScheduled(tickHandler);
        tickHandler = $.Schedule(TICK_INTERVAL, tick);
    }

    function tick() {
        if (!root) root = findRoot($.GetContextPanel());
        update();
        scheduleTick();
    }

    function update() {
        // don't show speedometer in hideout because it doesn't work
        if (isConnectedToHideout(root)) {
            speedometerLabel.text = "";
            return;
        }

        // fix centering on 1080p and lower resolutions
        if (gameplayHUD.actuallayoutheight <= 1080) {
            speedometerLabel.style.x = "1px";
        }
        else {
            speedometerLabel.style.x = "0px";
        }

        const pos = minimapPip.GetPositionWithinWindow();
        const minimapWidth = minimap.actuallayoutwidth;
        const minimapHeight = minimap.actuallayoutheight;
        const t = Date.now ? Date.now() : (new Date()).getTime(); // ms
        const x = pos.x / minimapWidth;
        const y = pos.y / minimapHeight;
        pos_samples.push({ t, x, y });
        if (pos_samples.length > MAX_SAMPLES) {
            pos_samples.shift();
        }
        
        // do the thing if there are at least 2 samples to work with
        if (pos_samples.length >= 2) {
            let maxDiff = 0;
            // get max difference between adjacent samples
            for (let i = 1; i < pos_samples.length; i++) {
                const dx = pos_samples[i].x - pos_samples[i - 1].x;
                const dy = pos_samples[i].y - pos_samples[i - 1].y;
                const dt = (pos_samples[i].t - pos_samples[i - 1].t) / 1000.0;
                const diff = Math.sqrt(dx * dx + dy * dy) / dt;
                if (diff > maxDiff) {
                    maxDiff = diff;
                }
            }
            // if the player teleported, reset the sample window to avoid a huge speed spike
            if (maxDiff > TELEPORT_THRESHOLD) {
                pos_samples = [pos_samples[pos_samples.length - 1]];
            }
            
            // least-squares regression to estimate velocity from minimap px samples
            let meanT = 0, meanX = 0, meanY = 0;
            for (const sample of pos_samples) {
                meanT += sample.t;
                meanX += sample.x;
                meanY += sample.y;
            }
            meanT /= pos_samples.length;
            meanX /= pos_samples.length;
            meanY /= pos_samples.length;

            let Stt = 0, Stx = 0, Sty = 0;
            for (const sample of pos_samples) {
                const dt = sample.t - meanT;
                Stt += dt * dt;
                Stx += dt * (sample.x - meanX);
                Sty += dt * (sample.y - meanY);
            }

            const vx = Stx / Stt;
            const vy = Sty / Stt;
            
            // convert from minimap units to speed units (px/ms to u/s)
            const raw2DSpeed = Math.sqrt(vx * vx + vy * vy) * 1000;
            const rawSpeed = raw2DSpeed * PIP_TO_UNITS; // minimap units -> u/s
            
            // smooth raw speed noise
            let dtSmoothSec = (lastSpeedTimeMs !== null) ? (t - lastSpeedTimeMs) / 1000.0 : TICK_INTERVAL;
            if (!(dtSmoothSec > 0) || dtSmoothSec > 1.0) dtSmoothSec = TICK_INTERVAL;

            if (smoothedSpeed === null || !isFinite(smoothedSpeed)) {
                smoothedSpeed = rawSpeed; // first reading: snap instead of easing in from 0
            } else {
                let alpha = 1.0 - Math.exp(-dtSmoothSec / SPEED_EMA_TAU_SEC);
                const sdelta = rawSpeed - smoothedSpeed;

                // Within the deadband, damp harder so a steady speed reads as a steady number instead of visibly wobbling.
                if (Math.abs(sdelta) < smoothedSpeed * SPEED_DEADBAND_FRAC) {
                    alpha *= 0.25;
                }
                if (rawSpeed < SPEED_REST_THRESHOLD) alpha = 1.0; // snap to rest

                smoothedSpeed = smoothedSpeed + (alpha * sdelta);
            }
            lastSpeedTimeMs = t;

            // interpolate color
            if (isFinite(smoothedSpeed)) {
                let r, g, b;
                if (smoothedSpeed <= TEXT_COLORS[0].speed) {
                    [r, g, b] = TEXT_COLORS[0].color;
                } else if (smoothedSpeed >= TEXT_COLORS[TEXT_COLORS.length - 1].speed) {
                    [r, g, b] = TEXT_COLORS[TEXT_COLORS.length - 1].color;
                } else {
                    for (let i = 0; i < TEXT_COLORS.length - 1; i++) {
                        const a = TEXT_COLORS[i];
                        const c = TEXT_COLORS[i + 1];
                        if (smoothedSpeed <= c.speed) {
                            const frac = (smoothedSpeed - a.speed) / (c.speed - a.speed);
                            r = a.color[0] + (c.color[0] - a.color[0]) * frac;
                            g = a.color[1] + (c.color[1] - a.color[1]) * frac;
                            b = a.color[2] + (c.color[2] - a.color[2]) * frac;
                            break;
                        }
                    }
                }
                
                const toHex = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
                speedometerLabel.style.color = `#${toHex(r)}${toHex(g)}${toHex(b)}FF`;
                speedometerLabel.text = smoothedSpeed.toFixed(0);

                // const speedometerDebug = root.FindChildTraverse("speedometerDebug");
                // speedometerDebug.text = `
                //     pos: (${x.toFixed(2)}, ${y.toFixed(2)})
                //     raw minimap speed: (${raw2DSpeed.toFixed(10)} px/s)
                //     max difference: (${maxDiff.toFixed(10)} u/s)
                //     raw speed: (${rawSpeed.toFixed(2)} u/s)
                //     smoothed speed: (${smoothedSpeed.toFixed(2)} u/s)
                //     minimap size: (${minimapWidth}, ${minimapHeight})
                //     gameplay hud size: (${gameplayHUD.actuallayoutwidth}, ${gameplayHUD.actuallayoutheight})
                //     offset by 1px: (${gameplayHUD.actuallayoutheight <= 1080})
                //     rgb: (${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})
                // `;
            }
        }
    }

    function isConnectedToHideout(rootPanel) {
        const hud = rootPanel.FindChildTraverse("Hud");
        if (!hud || !hud.BHasClass) return false;
        return hud.BHasClass("connectedToHideout") || hud.BHasClass("InHideout");
    }

    function findRoot(p) {
        while (p.GetParent && p.GetParent()) p = p.GetParent();
        return p;
    }

    boot();
})();
