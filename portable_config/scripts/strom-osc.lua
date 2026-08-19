-- Strøm Cinema OSC for MPV — v4 NO SHADING
-- A self-contained dark/orange controller styled after the Android ExoPlayer.

local mp = require 'mp'
local assdraw = require 'mp.assdraw'

local ORANGE = '006BFF' -- ASS colours are BGR: #FF6B00
local WHITE  = 'FFFFFF'
local MUTED  = 'A0A0A0'
local DARK   = '101011'
local BLACK  = '000000'

local visible = true
local hide_at = 0
local timeout = 4
local hitboxes = {}
local hovered = nil
local show_info = false
local toast_text = ''
local toast_until = 0
local sub_sizes = { 32, 40, 48, 56, 64 }
local sub_size_index = 2

local overlay = mp.create_osd_overlay('ass-events')

local function now()
    return mp.get_time()
end

local function clamp(value, low, high)
    return math.max(low, math.min(high, value))
end

local function ass_escape(value)
    value = tostring(value or '')
    value = value:gsub('\\', '\\e')
    value = value:gsub('{', '\\{')
    value = value:gsub('}', '\\}')
    value = value:gsub('\n', ' ')
    return value
end

local function format_time(seconds)
    seconds = math.max(0, math.floor(tonumber(seconds) or 0))
    local hours = math.floor(seconds / 3600)
    local minutes = math.floor((seconds % 3600) / 60)
    local secs = seconds % 60
    return string.format('%d:%02d:%02d', hours, minutes, secs)
end

local function draw_rect(ass, x0, y0, x1, y1, color, alpha, radius)
    local width = math.max(1, math.floor(x1 - x0))
    local height = math.max(1, math.floor(y1 - y0))
    local opacity = alpha or '00'
    ass:new_event()
    ass:an(7)
    ass:pos(math.floor(x0), math.floor(y0))
    ass:append(string.format(
        '{\\bord0\\shad0\\blur0\\1c&H%s&\\1a&H%s&\\2a&H%s&\\3a&H%s&\\4a&H%s&}',
        color, opacity, opacity, opacity, opacity
    ))
    ass:draw_start()
    if radius and radius > 0 then
        ass:round_rect_cw(0, 0, width, height, math.min(radius, width / 2, height / 2))
    else
        ass:rect_cw(0, 0, width, height)
    end
    ass:draw_stop()
end

local function draw_text(ass, x, y, text, size, color, align, bold, alpha)
    ass:new_event()
    ass:pos(math.floor(x), math.floor(y))
    ass:append(string.format(
        '{\\an%d\\fnJetBrains Mono\\fs%d\\bord0\\shad1\\1c&H%s&\\1a&H%s&%s}',
        align or 7,
        math.floor(size),
        color or WHITE,
        alpha or '00',
        bold and '\\b1' or '\\b0'
    ))
    ass:append(ass_escape(text))
end

local function add_hitbox(id, x0, y0, x1, y1, action)
    table.insert(hitboxes, {
        id = id,
        x0 = x0, y0 = y0, x1 = x1, y1 = y1,
        action = action,
    })
end

local function point_inside(box, x, y)
    return x >= box.x0 and x <= box.x1 and y >= box.y0 and y <= box.y1
end

local function selected_track(track_type)
    local tracks = mp.get_property_native('track-list', {}) or {}
    for _, track in ipairs(tracks) do
        if track.type == track_type and track.selected then
            local label = track.lang
            local track_title = tostring(track.title or '')
            if (not label or label == '') and track_title ~= '' and #track_title <= 28
                and not track_title:match('%.%w%w%w%w?$') then
                label = track_title
            end
            label = label or ('Track ' .. tostring(track.id or ''))
            return tostring(label):upper()
        end
    end
    return track_type == 'sub' and 'OFF' or 'AUTO'
end

local function show_controls()
    visible = true
    hide_at = now() + timeout
end

local function show_toast(message)
    toast_text = message
    toast_until = now() + 1.8
    show_controls()
end

local function toggle_play()
    mp.commandv('cycle', 'pause')
    show_controls()
end

local function seek_back()
    mp.commandv('seek', '-10', 'relative', 'exact')
    show_controls()
end

local function seek_forward()
    mp.commandv('seek', '10', 'relative', 'exact')
    show_controls()
end

local function cycle_audio()
    mp.commandv('cycle', 'aid')
    show_controls()
    mp.add_timeout(0.05, function()
        show_toast('AUDIO  ' .. selected_track('audio'))
    end)
end

local function cycle_subs()
    mp.commandv('cycle', 'sid')
    show_controls()
    mp.add_timeout(0.05, function()
        show_toast('SUBTITLES  ' .. selected_track('sub'))
    end)
end

local function cycle_sub_style()
    sub_size_index = (sub_size_index % #sub_sizes) + 1
    local size = sub_sizes[sub_size_index]
    mp.set_property_number('sub-font-size', size)
    show_controls()
    show_toast('SUBTITLE SIZE  ' .. tostring(size))
end

local function toggle_info()
    show_info = not show_info
    show_controls()
end

local function button(ass, id, x, y, width, height, label, primary, action, scale)
    local is_hovered = hovered == id
    local fill = primary and ORANGE or DARK
    local alpha = primary and '00' or '18'
    if is_hovered then
        fill = ORANGE
        alpha = '00'
    end
    draw_rect(ass, x, y, x + width, y + height, fill, alpha, 12 * scale)
    if not primary and not is_hovered then
        draw_rect(ass, x, y + height - math.max(1, scale), x + width, y + height, '404040', '60')
    end
    draw_text(
        ass,
        x + width / 2,
        y + height / 2 + 1 * scale,
        label,
        (primary and 25 or 14) * scale,
        WHITE,
        5,
        true
    )
    add_hitbox(id, x, y, x + width, y + height, action)
end

local function draw_info_panel(ass, width, scale)
    if not show_info then return end
    local panel_w = 480 * scale
    local x0 = width - panel_w - 42 * scale
    local y0 = 90 * scale
    local line = 35 * scale
    local rows = {
        { 'VIDEO', mp.get_property('video-codec', 'Unknown') },
        { 'RESOLUTION', (mp.get_property('width', '?') .. ' × ' .. mp.get_property('height', '?')) },
        { 'FRAME RATE', mp.get_property('estimated-vf-fps', '?') .. ' fps' },
        { 'AUDIO', mp.get_property('audio-codec-name', 'Unknown') },
        { 'AUDIO TRACK', selected_track('audio') },
        { 'SUBTITLES', selected_track('sub') },
    }
    draw_rect(ass, x0, y0, width - 42 * scale, y0 + (#rows * line) + 46 * scale, BLACK, '18', 12 * scale)
    for index, row in ipairs(rows) do
        local y = y0 + 24 * scale + (index - 1) * line
        draw_text(ass, x0 + 22 * scale, y, row[1], 15 * scale, index == 1 and ORANGE or MUTED, 7, true)
        draw_text(ass, width - 64 * scale, y, row[2], 17 * scale, WHITE, 9, true)
    end
end

local function draw_toast(ass, width, height, scale)
    if toast_text == '' or now() >= toast_until then return end
    local box_w = math.min(width - 80 * scale, 460 * scale)
    local box_h = 62 * scale
    local x0 = (width - box_w) / 2
    local y0 = height - 215 * scale
    draw_rect(ass, x0, y0, x0 + box_w, y0 + box_h, BLACK, '18', 14 * scale)
    draw_text(ass, width / 2, y0 + box_h / 2, toast_text, 18 * scale, WHITE, 5, true)
end

local function render()
    if not visible then
        overlay:remove()
        return
    end

    local width, height = mp.get_osd_size()
    if not width or width <= 0 or not height or height <= 0 then return end

    local scale = math.max(0.65, math.min(width / 1920, height / 1080))
    local ass = assdraw.ass_new()
    hitboxes = {}

    -- Keep the video image completely unobstructed. Buttons provide their own
    -- backgrounds, so no full-width shading is needed behind the controls.

    local title = os.getenv('STROM_MEDIA_TITLE') or mp.get_property('media-title', 'Strøm Cinema')
    local episode = os.getenv('STROM_EPISODE_LABEL') or ''
    draw_text(ass, 42 * scale, 34 * scale, title, 21 * scale, WHITE, 7, true)
    if episode ~= '' then
        draw_text(ass, 42 * scale, 64 * scale, episode, 13 * scale, MUTED, 7, true)
    end
    draw_text(ass, width - 42 * scale, 38 * scale, os.date('%H:%M'), 18 * scale, WHITE, 9, true)

    local duration = mp.get_property_number('duration', 0) or 0
    local position = mp.get_property_number('time-pos', 0) or 0
    local progress = duration > 0 and clamp(position / duration, 0, 1) or 0
    local bar_x0 = 48 * scale
    local bar_x1 = width - 48 * scale
    local bar_y = height - 126 * scale
    local bar_h = 5 * scale

    draw_text(ass, bar_x0, bar_y - 15 * scale, format_time(position), 12 * scale, WHITE, 7, true)
    draw_text(ass, bar_x1, bar_y - 15 * scale, format_time(duration), 12 * scale, MUTED, 9, false)
    draw_rect(ass, bar_x0, bar_y, bar_x1, bar_y + bar_h, '555555', '30')
    draw_rect(ass, bar_x0, bar_y, bar_x0 + (bar_x1 - bar_x0) * progress, bar_y + bar_h, ORANGE, '00')
    local knob_x = bar_x0 + (bar_x1 - bar_x0) * progress
    draw_rect(ass, knob_x - 4 * scale, bar_y - 4 * scale, knob_x + 4 * scale, bar_y + 9 * scale, ORANGE, '00')
    add_hitbox('seek', bar_x0, bar_y - 14 * scale, bar_x1, bar_y + 18 * scale, 'seek')

    local y = height - 94 * scale
    local normal_w = 112 * scale
    local play_w = 70 * scale
    local btn_h = 54 * scale
    local gap = 10 * scale
    local x = 48 * scale

    button(ass, 'back', x, y, normal_w, btn_h, '↶  10s', false, seek_back, scale)
    x = x + normal_w + gap
    local paused = mp.get_property_native('pause', false)
    button(ass, 'play', x, y - 5 * scale, play_w, btn_h + 10 * scale, paused and '▶' or 'Ⅱ', true, toggle_play, scale)
    x = x + play_w + gap
    button(ass, 'forward', x, y, normal_w, btn_h, '10s  ↷', false, seek_forward, scale)

    local info_w = 72 * scale
    local style_w = 72 * scale
    local subs_w = 120 * scale
    local audio_w = 130 * scale
    local right = width - 48 * scale

    button(ass, 'info', right - info_w, y, info_w, btn_h, 'ⓘ', false, toggle_info, scale)
    right = right - info_w - gap
    button(ass, 'style', right - style_w, y, style_w, btn_h, 'Aa', false, cycle_sub_style, scale)
    right = right - style_w - gap
    button(ass, 'subs', right - subs_w, y, subs_w, btn_h, 'CC  ' .. selected_track('sub'), false, cycle_subs, scale)
    right = right - subs_w - gap
    button(ass, 'audio', right - audio_w, y, audio_w, btn_h, '♪  ' .. selected_track('audio'), false, cycle_audio, scale)

    draw_toast(ass, width, height, scale)
    draw_info_panel(ass, width, scale)

    overlay.res_x = width
    overlay.res_y = height
    overlay.data = ass.text
    overlay:update()
end

local function update_hover()
    show_controls()
    local x, y = mp.get_mouse_pos()
    hovered = nil
    if x and y then
        for _, box in ipairs(hitboxes) do
            if point_inside(box, x, y) then
                hovered = box.id
                break
            end
        end
    end
    render()
end

local function handle_click(event)
    if event and event.event and event.event ~= 'down' then return end
    if not visible then
        show_controls()
        render()
        return
    end
    local x, y = mp.get_mouse_pos()
    if not x or not y then return end
    for _, box in ipairs(hitboxes) do
        if point_inside(box, x, y) then
            if box.action == 'seek' then
                local duration = mp.get_property_number('duration', 0) or 0
                if duration > 0 then
                    local percent = clamp((x - box.x0) / (box.x1 - box.x0) * 100, 0, 100)
                    mp.commandv('seek', tostring(percent), 'absolute-percent', 'exact')
                end
            elseif type(box.action) == 'function' then
                box.action()
            end
            render()
            return
        end
    end
    toggle_play()
end

local function tick()
    if visible and now() >= hide_at and not show_info then
        visible = false
        hovered = nil
        overlay:remove()
        return
    end
    if visible then render() end
end

mp.register_script_message('toggle-play', toggle_play)
mp.register_script_message('seek-back', seek_back)
mp.register_script_message('seek-forward', seek_forward)
mp.register_script_message('cycle-audio', cycle_audio)
mp.register_script_message('cycle-subs', cycle_subs)
mp.register_script_message('toggle-info', toggle_info)

mp.add_forced_key_binding('MOUSE_MOVE', 'strom-mouse-move', update_hover)
mp.add_forced_key_binding('MBTN_LEFT', 'strom-mouse-click', handle_click, { complex = true })
mp.add_forced_key_binding('MBTN_LEFT_DBL', 'strom-double-click', function()
    mp.commandv('cycle', 'fullscreen')
    show_controls()
end)

mp.observe_property('pause', 'bool', function() show_controls(); render() end)
mp.observe_property('aid', 'native', function() if visible then render() end end)
mp.observe_property('sid', 'native', function() if visible then render() end end)
mp.register_event('file-loaded', function()
    visible = true
    hide_at = now() + timeout
    render()
end)

show_controls()
mp.add_periodic_timer(0.1, tick)
