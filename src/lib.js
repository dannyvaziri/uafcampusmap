export const UAF_BLUE='#236192'
export const UAF_GOLD='#FFCD00'
export const MAP_CENTER=[64.857,-147.829]
export const popularIds=['signers','wood','library','patty','museum','fine-arts','health-safety','src']
export const normalize=v=>String(v??'').toLowerCase().trim()
export const exactPoint=b=>Number.isFinite(b.latitude)&&Number.isFinite(b.longitude)
export const isVerifiedPoint=b=>exactPoint(b)&&/UAF directions/i.test(b.geometry_status||'')
export const googleDirections=i=>`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(i.address||`UAF ${i.name||i.common_name}, Fairbanks, AK`)}`
export const appleDirections=i=>`https://maps.apple.com/?daddr=${encodeURIComponent(i.address||`UAF ${i.name||i.common_name}, Fairbanks, AK`)}`
