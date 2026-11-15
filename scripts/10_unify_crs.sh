#!/bin/bash
# 1단계: 모든 래스터 원본에 공통 좌표계(반지름 3,396,190m 구의 경위도)를 붙인 VRT를 만든다.
# Plan/03 1단계, Plan/05 D10. 원본은 읽기만 하고, 결과는 work/vrt/ 에만 쓴다.
#
#  - 경위도 원본: gdal_translate -of VRT -a_srs  (표기만 교체, 화소·좌표값 그대로)
#  - 미터 원본(단순 원통 = eqc, 표준위선 0°, 같은 구):
#      x = R·λ, y = R·φ 이므로 경위도 = 미터 / (R·π/180) 인 순수 비례 관계다.
#      원본 표기를 같은 구(+R=3396190)의 eqc로 덮어쓴 뒤 이 비례식으로 네 귀퉁이를
#      도 단위로 바꿔 -a_ullr 로 붙인다. gdalwarp 결과와 같은 격자이지만(검증은
#      11_check_alignment.py 의 "warp_equivalence") 재표본화가 없고 원본 overview를
#      그대로 쓸 수 있다.
#  - curiosity_hirise_mosaic.tif.part 는 내려받는 중이므로 포함하지 않는다(건드리지 않음).
set -euo pipefail
export PATH=/Applications/Postgres.app/Contents/Versions/latest/bin:$PATH
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
OUT=work/vrt
mkdir -p "$OUT"
COMMON=$(python3 -I -c 'import json;print(json.load(open("scripts/config.json"))["crs"]["common"])')
SPHERE_EQC0="+proj=eqc +lat_ts=0 +lat_0=0 +lon_0=0 +x_0=0 +y_0=0 +R=3396190 +units=m +no_defs"
SPHERE_EQC180="+proj=eqc +lat_ts=0 +lat_0=0 +lon_0=180 +x_0=0 +y_0=0 +R=3396190 +units=m +no_defs"
X=MarsTrek/extra

# VRT 안의 원본 경로는 절대 경로로 둔다(VRT를 옮겨도 열리게).
src() { echo "$ROOT/$1"; }

relabel_lonlat() {  # $1 = 출력 이름, $2 = 원본
  gdal_translate -q -of VRT -a_srs "$COMMON" "$(src "$2")" "$OUT/$1.vrt"
  echo "relabel  $1  <- $2"
}

# 미터(eqc) 원본 → 경위도. $1 출력, $2 원본, $3 원본 중앙 경도(0 또는 180)
eqc_to_lonlat() {
  local name=$1 file=$2 lon0=$3
  local s_srs=$SPHERE_EQC0; [ "$lon0" = 180 ] && s_srs=$SPHERE_EQC180
  # (1) 원본 표기를 같은 구의 eqc로 덮어쓴 중간 VRT (기록용, warp 동등성 검사에 사용)
  mkdir -p "$OUT/_eqc"
  gdal_translate -q -of VRT -a_srs "$s_srs" "$(src "$file")" "$OUT/_eqc/$name.vrt"
  # (2) 미터 → 도 비례 변환으로 귀퉁이 계산
  local ullr
  ullr=$(gdalinfo -json "$OUT/_eqc/$name.vrt" | python3 -I -c '
import json,sys,math
d=json.load(sys.stdin); gt=d["geoTransform"]; w,h=d["size"]; lon0=float(sys.argv[1])
assert gt[2]==0 and gt[4]==0
k=3396190*math.pi/180.0
ulx=gt[0]; uly=gt[3]; lrx=gt[0]+gt[1]*w; lry=gt[3]+gt[5]*h
print("%.15f %.15f %.15f %.15f"%(lon0+ulx/k, uly/k, lon0+lrx/k, lry/k))' "$lon0")
  # shellcheck disable=SC2086
  # 최종 VRT는 원본 파일을 직접 가리킨다(중첩 VRT를 피해 원본 overview가 그대로 쓰이게).
  gdal_translate -q -of VRT -a_srs "$COMMON" -a_ullr $ullr "$(src "$file")" "$OUT/$name.vrt"
  echo "eqc->ll  $1  <- $2  (ullr $ullr)"
}

# --- 경위도 원본 (표기만 교체) ---
relabel_lonlat B1_ctx_5m                MarsTrek/Gale_CTX_BlockAdj_dd.tif       # 원 표기: 구 → 같음
relabel_lonlat dem_1m                   MarsTrek/Gale_DEM_SMG_1m.tif           # 원 표기: 편평 타원체
relabel_lonlat ctx_curiosity_16m        $X/curiosity_ctx_mosaic.tif            # 원 표기: 편평 타원체
relabel_lonlat B4_themis_night_ir_100m  $X/THEMIS_night_IR_USGS_WCS_lon130-145_lat-12-3.tif       # 원 표기: WGS84(오류)
relabel_lonlat B5_themis_day_ir_100m    $X/THEMIS_controlled_IR_USGS_WCS_lon130-145_lat-12-3.tif  # 원 표기: WGS84(오류)
relabel_lonlat E2_tes_albedo            $X/Mars_MGS_TES_Albedo_mosaic_global_7410m.tif
relabel_lonlat E2_tes_thermal_inertia   $X/TES_Thermal_Inertia.tif
relabel_lonlat E2_tes_dust              $X/TES_Dust.tif
relabel_lonlat E2_tes_clinopyroxene     $X/TES_Clinopyroxene.tif
relabel_lonlat E2_tes_plagioclase       $X/TES_Plagioclase.tif
relabel_lonlat E2_tes_glass_clay        $X/TES_Glass_Clay.tif
relabel_lonlat E2_tes_ruffdust          $X/tes_ruffdust.tif
relabel_lonlat E2_mola_roughness        $X/mola_roughness.tif
relabel_lonlat pahrump_patch_3cm        $X/mars_pahrump_patch_8k_256m.tif

# --- 미터 원본 (같은 구의 eqc → 경위도 비례 변환) ---
eqc_to_lonlat B2_hirise_color_25cm  $X/MSL_Gale_HiRISE-LRGB_78quads_sharp_cog.tif 0
eqc_to_lonlat T6_mola_463m          $X/Mars_MGS_MOLA_DEM_mosaic_global_463m.tif 0
eqc_to_lonlat E1_themis_ti_100m     $X/THEMIS_TI_Mosaic_Quant_30S120E_100mpp.cub 0
eqc_to_lonlat themis_day_ir_isis_100m  $X/gale_crater_themis_dayir_isis.cub 180
eqc_to_lonlat themis_vis_isis_18m      $X/Gale_crater_THEMIS_VIS_ISIS.cub 180

# --- 정렬 보정 (11_check_alignment.py 측정 결과, Plan/06) ---
# config.json "alignment_corrections": {레이어: {east_m, north_m}} 만큼 래스터 전체를 평행이동한다.
# 보정 전 VRT는 work/vrt/_raw/ 에 남긴다. 경도 이동량은 게일 중심 위도(-4.7°)의 cos로 환산.
mkdir -p "$OUT/_raw"
python3 -I -c '
import json
c=json.load(open("scripts/config.json")).get("alignment_corrections",{})
for k,v in c.items():
    if not k.startswith("_"): print(k, v["east_m"], v["north_m"])' | while read -r name de dn; do
  cp "$OUT/$name.vrt" "$OUT/_raw/$name.vrt"
  read -r srcfile ullr < <(gdalinfo -json "$OUT/_raw/$name.vrt" | python3 -I -c '
import json,sys,math
d=json.load(sys.stdin); gt=d["geoTransform"]; w,h=d["size"]
de,dn=float(sys.argv[1]),float(sys.argv[2]); k=3396190*math.pi/180
dlon=de/(k*math.cos(math.radians(-4.7))); dlat=dn/k
src=[f for f in d["files"] if not f.endswith(".vrt")][0]
print(src, "%.15f %.15f %.15f %.15f"%(gt[0]+dlon, gt[3]+dlat, gt[0]+gt[1]*w+dlon, gt[3]+gt[5]*h+dlat))' "$de" "$dn")
  # shellcheck disable=SC2086
  gdal_translate -q -of VRT -a_srs "$COMMON" -a_ullr $ullr "$srcfile" "$OUT/$name.vrt"
  echo "corrected $name  east ${de}m north ${dn}m"
done

# 요약
echo
for f in "$OUT"/*.vrt; do
  gdalinfo -json "$f" | python3 -I -c '
import json,sys
d=json.load(sys.stdin); gt=d["geoTransform"]; w,h=d["size"]
print("%-36s %6dx%-6d px=%.3e deg  lon %.4f..%.4f  lat %.4f..%.4f  bands=%d"%(sys.argv[1].split("/")[-1],w,h,gt[1],gt[0],gt[0]+gt[1]*w,gt[3]+gt[5]*h,gt[3],len(d["bands"])))' "$f"
done
