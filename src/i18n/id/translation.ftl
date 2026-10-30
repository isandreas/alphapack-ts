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
error_admin_only = ❌ Perintah ini hanya untuk administrator.
error_owner_only = ❌ Anda tidak memiliki izin untuk menggunakan perintah ini.

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

# Fase 7 — Ops & Health
# String perintah /health
health_dm_only = ❌ Perintah ini hanya dapat digunakan dalam pesan pribadi dengan bot.
health_cooldown = ⏳ Tunggu { $seconds }s lagi sebelum menggunakan /health lagi.
settings_cooldown = ⏳ Tunggu { $seconds }s lagi sebelum membuka /settings lagi.
settings_edit_cooldown = ⏳ Tunggu { $seconds }s lagi sebelum mengedit pengaturan lain.

# Perintah Grup (!star, !user, !adminlist)
usage_star = ⚠️ Penggunaan: !star <@username|user_id> +[n]|-[n] atau balas pesan dengan !star +[n]|-[n]
reply_star_updated = ⭐ { $target } ({ $change }) sekarang memiliki <b>{ $stars }</b> bintang.
error_user_not_found = ❌ Pengguna tidak ditemukan.
user_info_card =
    👤 <b>Informasi Pengguna</b>

    • <b>Nama:</b> { $name }
    • <b>ID Pengguna:</b> <code>{ $userId }</code>
    • <b>Username:</b> { $username }
    • <b>Peringatan:</b> { $warns }/{ $warnThreshold }
    • <b>Bintang:</b> ⭐ { $stars }
adminlist_header = 🛡️ <b>Administrator Grup</b>
adminlist_creator_label = 👑 <b>Pemilik:</b>
adminlist_admins_label = 👮 <b>Admin:</b>
adminlist_none = -

# Persetujuan Grup & Manajemen Grup Pemilik
group_approval_request =
    🔔 <b>Permintaan Persetujuan Grup</b>

    Bot memerlukan persetujuan Anda untuk berjalan di grup ini:
    • <b>Grup:</b> { $title }
    • <b>ID Chat:</b> <code>{ $chatId }</code>
    • <b>Ditambahkan oleh:</b> { $addedBy }

    Apakah Anda menyetujui bot untuk berjalan di grup ini?
btn_approve_group = ✅ Setujui
btn_reject_group = ❌ Tolak
group_approval_approved =
    ✅ <b>Grup Disetujui</b>

    • <b>Grup:</b> { $title }
    • <b>ID Chat:</b> <code>{ $chatId }</code>
group_approval_rejected =
    ❌ <b>Grup Ditolak</b>

    • <b>Grup:</b> { $title }
    • <b>ID Chat:</b> <code>{ $chatId }</code>

    Bot telah mengucapkan selamat tinggal dan keluar dari grup.
group_approval_pending = ⏳ This group's request to use the bot is pending and will be evaluated by the bot owner.
group_approved_notice = ✅ The request has been approved by the bot owner! Admins can now start configuring the bot with /settings.
group_rejected_goodbye = 👋 Goodbye! The bot owner does not approve this bot to run in this group. Leaving now.
activegroups_empty = 📋 Saat ini tidak ada grup aktif yang disetujui.
activegroups_header = 📋 <b>Grup Aktif yang Disetujui ({ $count })</b>
usage_exitgroup = ⚠️ Penggunaan: /exitgroup <chat_id> (contoh: /exitgroup -1001234567890)
exitgroup_success = ✅ Berhasil keluar dari grup <b>{ $title }</b> (<code>{ $chatId }</code>) dan menghapusnya dari daftar grup aktif.
exitgroup_failed = ⚠️ Menghapus <code>{ $chatId }</code> dari daftar grup aktif, tetapi gagal keluar dari chat di Telegram (bot mungkin sudah keluar).
usage_bangroup = ⚠️ Penggunaan: /bangroup <chat_id> (contoh: /bangroup -1001234567890)
bangroup_success = 🚫 Grup <code>{ $chatId }</code> telah diblokir (ban). Bot akan otomatis keluar jika diundang.
usage_unbangroup = ⚠️ Penggunaan: /unbangroup <chat_id> (contoh: /unbangroup -1001234567890)
unbangroup_success = ✅ Blokir untuk grup <code>{ $chatId }</code> telah dibuka (unban).
unbangroup_not_banned = ℹ️ Grup <code>{ $chatId }</code> tidak ada dalam daftar grup yang diblokir.

# Grup Inbox & Kirim Pesan
setinboxgroup_dm_only = ❌ Perintah ini hanya dapat digunakan di DM dengan bot. Kirim pesan pribadi!
setinboxgroup_checking = ⏳ Memeriksa status admin Anda di seluruh grup...
setinboxgroup_no_groups = Anda bukan admin di grup aktif mana pun yang saat ini memiliki bot ini.
setinboxgroup_min_two_groups = ⚠️ Anda harus menjadi admin di minimal 2 grup aktif bersama bot untuk mengatur grup inbox (satu grup asal dan satu grup inbox tujuan).
setinboxgroup_select_source = Langkah 1: Pilih grup asal yang pesan DM anggotanya ingin diteruskan:
setinboxgroup_select_target =
    Langkah 2: Pilih grup inbox tujuan untuk <b>{ $group }</b> dari tombol di bawah, atau kirimkan <code>&lt;chat_id&gt;</code> grup tujuan:
setinboxgroup_btn_cancel = ❌ Batal
setinboxgroup_cancelled = ❌ Operasi dibatalkan.
setinboxgroup_same_group_error = ❌ Grup inbox tujuan tidak boleh sama dengan grup asal.
setinboxgroup_cleared = ✅ Grup inbox telah dinonaktifkan untuk <b>{ $group }</b>.
unsetinboxgroup_none_configured = ℹ️ Tidak ada grup Anda yang saat ini memiliki konfigurasi grup inbox.
unsetinboxgroup_select_group = Pilih grup yang konfigurasi grup inbox-nya ingin Anda hapus:
setinboxgroup_invalid_target = ❌ Pilihan grup atau ID chat tidak valid. Silakan jalankan !setinboxgroup lagi.
setinboxgroup_not_target_admin = ❌ Anda harus menjadi administrator di grup inbox tujuan untuk menghubungkannya.
setinboxgroup_bot_not_member = ❌ Saya bukan anggota (atau tidak dapat mengirim pesan) di grup tujuan tersebut. Tambahkan saya ke grup tujuan terlebih dahulu, lalu coba !setinboxgroup lagi.
setinboxgroup_success = ✅ Grup inbox untuk <b>{ $group }</b> telah diatur ke <b>{ $inbox }</b> (<code>{ $inboxId }</code>).
setinboxgroup_target_confirm = 📥 Grup ini sekarang diatur sebagai grup inbox untuk <b>{ $group }</b>. Balas (reply) pesan pengguna yang diteruskan di sini untuk membalas melalui bot.

usage_sendmessage = ⚠️ Penggunaan: !sendmessage <chat_id> <pesan> (atau lampirkan media / balas pesan di DM dengan !sendmessage <chat_id> [caption])
sendmessage_unauthorized = ❌ Anda tidak memiliki izin untuk mengirim pesan atas nama bot ke grup <code>{ $chatId }</code>.
sendmessage_success = ✅ Pesan berhasil dikirim ke <b>{ $title }</b> (<code>{ $chatId }</code>).
sendmessage_failed = ❌ Gagal mengirim pesan ke <code>{ $chatId }</code>. Pastikan bot berada di grup tersebut dan memiliki izin mengirim pesan.

inbox_relay_header =
    📩 <b>Pesan Masuk dari Pengguna</b>
    • <b>Dari:</b> { $sender } (<code>{ $userId }</code>)
    • <b>Username:</b> { $username }
    • <b>Grup:</b> { $group }
inbox_multi_group_note = ℹ️ <i>Catatan: Pengguna ini berada di beberapa grup bersama bot ({ $groups }).</i>
inbox_reply_sent = ✅ Balasan terkirim ke pengguna.
inbox_reply_failed = ❌ Gagal mengirim balasan ke pengguna (pengguna mungkin telah memblokir bot).

# Bot Command Descriptions
cmd_desc_rules = Lihat peraturan grup
cmd_desc_guide = Lihat panduan dan tautan grup
cmd_desc_ping = Cek latensi dan status bot
cmd_desc_warn = Beri peringatan kepada anggota
cmd_desc_mute = Bisukan anggota sementara atau permanen
cmd_desc_ban = Blokir anggota permanen
cmd_desc_tban = Blokir anggota sementara
cmd_desc_unmute = Buka bisu anggota
cmd_desc_unban = Buka blokir anggota
cmd_desc_settings = Buka menu pengaturan grup
cmd_desc_start = Mulai bot dan lihat info




