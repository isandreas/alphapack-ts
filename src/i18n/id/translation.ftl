ping-response = 🏓 Pong! Bot hidup dan berjalan.
start-greeting =
    Halo! Saya AlphaPack 🤖
    Saya bisa membantu mengelola grup Anda. Tambahkan saya ke grup dan jadikan admin!

# Errors
error_group_only = ❌ Perintah ini hanya dapat digunakan di grup.
error_immune_bot = ❌ Saya tidak bisa memoderasi diri saya sendiri.
error_immune_self = ❌ Anda tidak bisa memoderasi diri Anda sendiri.
error_immune_admin = ❌ Target adalah admin dan tidak bisa dimoderasi.
error_ban_failed = ❌ Gagal memblokir (ban) pengguna. Periksa izin saya.
error_unban_failed = ❌ Gagal membuka blokir pengguna.
error_mute_failed = ❌ Gagal membisukan (mute) pengguna. Periksa izin saya.
error_unmute_failed = ❌ Gagal membuka bisu pengguna.

# Usage
usage_warn = ⚠️ Penggunaan: /warn <user_id> [alasan] atau balas pesan dengan /warn [alasan]
usage_mute = ⚠️ Penggunaan: /mute <user_id> [durasi] [alasan] atau balas pesan dengan /mute [durasi] [alasan]
usage_unmute = ⚠️ Penggunaan: /unmute <user_id> atau balas pesan dengan /unmute
usage_ban = ⚠️ Penggunaan: /ban <user_id> [alasan] atau balas pesan dengan /ban [alasan]
usage_tban = ⚠️ Penggunaan: /tban <user_id> <durasi> [alasan] atau balas pesan dengan /tban <durasi> [alasan]
usage_unban = ⚠️ Penggunaan: /unban <user_id> atau balas pesan dengan /unban

reply_warned =
    ⚠️ { $target } telah diperingatkan ({ $count }/{ $threshold }).

    Alasan: { $reason }
reply_muted =
    🔇 { $target } telah dibisukan selama { $duration }.

    Alasan: { $reason }
reply_unmuted = 🔊 { $target } telah dibuka bisunya.
reply_banned =
    🔨 { $target } telah diblokir secara permanen.

    Alasan: { $reason }
reply_tbanned =
    🔨 { $target } telah diblokir sementara selama { $duration }.

    Alasan: { $reason }
reply_unbanned = 🕊️ { $target } telah dibuka blokirnya.
reply_unbanned_reset = 🕊️ { $target } telah dibuka blokirnya. (Penghitung peringatan disetel ulang ke 0)
reply_flood_muted = 🔇 { $target } telah dibisukan otomatis selama { $duration } karena mengirim pesan terlalu cepat.

# Helpers
no_reason_provided = -
reason_warn_limit_reached = Diblokir secara otomatis karena mencapai batas peringatan.
error_generic = ❌ Terjadi kesalahan.
btn_remove_warn = ➖ Hapus Peringatan (-1)
warn_removed = ✅ Peringatan dihapus.
reply_warn_removed = ✅ Peringatan dihapus untuk { $target } ({ $count }/{ $threshold }).
rejoin_group_btn = 🔗 Bergabung Kembali
group_tban_expired = 🕊️ Blokir sementara { $target } telah kedaluwarsa.

# DM Notifications
dm_warn = ⚠️ Anda telah diperingatkan di { $group } ({ $count }/{ $threshold }).
    Alasan: { $reason }

dm_mute = 🔇 Anda telah dibisukan di { $group } selama { $duration }.
    Alasan: { $reason }

dm_tban = 🔨 Anda telah diblokir sementara dari { $group } selama { $duration }.
    Alasan: { $reason }

dm_ban = 🔨 Anda telah diblokir secara permanen dari { $group }.
    Alasan: { $reason }

dm_unmute = 🔊 Bisu Anda di { $group } telah dicabut.
dm_unban = 🕊️ Blokir Anda di { $group } telah dicabut.
dm_tban_expired = 🕊️ Blokir sementara Anda di { $group } telah kedaluwarsa.
dm_unmute_expired = 🔊 Bisu sementara Anda di { $group } telah kedaluwarsa.
dm_flood_mute = 🔇 Anda telah dibisukan otomatis di { $group } selama { $duration } karena mengirim pesan terlalu cepat.

# Log Channel Setup
setlogchannel_dm_only = ❌ Perintah ini hanya dapat digunakan di DM dengan bot. Kirim pesan pribadi!
setlogchannel_no_groups = Anda bukan admin di grup mana pun yang saat ini memiliki bot ini.
setlogchannel_select_group = Pilih grup yang ingin Anda konfigurasikan saluran log-nya:
setlogchannel_forward_prompt = Teruskan (forward) pesan apa saja dari channel yang ingin Anda gunakan sebagai saluran log untuk <b>{ $group }</b>.
setlogchannel_not_channel_forward = ❌ Itu bukan pesan yang diteruskan dari channel. Silakan forward pesan dari channel yang ingin Anda gunakan.
setlogchannel_bot_not_admin = ❌ Saya bukan admin dengan izin "Post Messages" di channel tersebut. Tambahkan saya sebagai admin di channel terlebih dahulu, lalu coba !setlogchannel lagi.
setlogchannel_success = ✅ Saluran log telah diatur untuk <b>{ $group }</b>.
setlogchannel_channel_confirm = ✅ Channel ini sekarang menjadi saluran log untuk { $group }.
setlogchannel_checking = ⏳ Memeriksa status admin Anda di seluruh grup...

# Mentions & Relay
error_admin_relay_cooldown = ⚠️ Silakan tunggu sebelum memanggil admin lagi.
reply_admin_notified = 🔔 Admin telah diberitahu.
dm_user_mentioned = 💬 Anda disebut di <b>{ $group }</b> oleh <b>{ $sender }</b>.

# Settings Control Panel (Phase 5)
error_moderation_disabled = ⚠️ Perintah { $feature } saat ini dinonaktifkan di grup ini.
rules_not_set = ⚠️ Peraturan belum diatur untuk grup ini.
settings_dm_start_prompt = ⚠️ Silakan mulai DM dengan bot untuk membuka panel pengaturan.
settings_checking_groups = ⏳ Mencari grup di mana Anda dan bot sama-sama menjadi admin...
settings_select_group = Pilih grup yang ingin Anda konfigurasikan:

# Filter Alfabet & Media — Pemberitahuan Grup (Fase 6)
# Dikirim ke chat grup saat pesan dihapus oleh filter moderasi otomatis.
reply_restriction_removed = 🚫 Pesan Dihapus. Alasan: { $reason }

# Filter alfabet — string alasan (digunakan dalam pemberitahuan grup dan kartu log)
reason_alphabet_cyrillic = pesan mengandung aksara Sirilik (dibatasi)
reason_alphabet_arabic = pesan mengandung aksara Arab (dibatasi)
reason_alphabet_cjk = pesan mengandung aksara CJK (dibatasi)
reason_alphabet_thai = pesan mengandung aksara Thai (dibatasi)
reason_alphabet_hebrew = pesan mengandung aksara Ibrani (dibatasi)
reason_alphabet_devanagari = pesan mengandung aksara Devanagari (dibatasi)

# Filter media — string alasan (digunakan dalam pemberitahuan grup dan kartu log)
reason_media_photo = pengiriman foto dibatasi
reason_media_video = pengiriman video dibatasi
reason_media_sticker = pengiriman stiker dibatasi
reason_media_gif = pengiriman GIF/animasi dibatasi
reason_media_link = pengiriman tautan dibatasi
