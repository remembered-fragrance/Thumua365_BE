#!/bin/sh
# Thay script mặc định của image postgis/postgis — script đó bật PostGIS trong
# schema `public`. Supabase để PostGIS trong schema `extensions`, và migration đầu
# tiên tự bật nó ở đó. Cố ý không làm gì.
#
# KHÔNG dùng `exit` ở đây: file không có quyền thực thi thì entrypoint của image
# `source` nó — `exit` sẽ thoát luôn entrypoint và container tắt (đã gặp trên CI).
:
