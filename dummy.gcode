G28 ; Home all axes
G1 Z5 F5000 ; Lift nozzle
M104 S210 ; Set nozzle temp
M140 S60 ; Set bed temp
G1 X100 Y100 F5000 ; Move to center
M109 S210 ; Wait for nozzle temp
M190 S60 ; Wait for bed temp
; Print some plastic
G1 X110 Y110 E10 F1500
G1 X120 Y120 E20 F1500
G28 X0 Y0 ; Home X and Y
M104 S0 ; Turn off nozzle
M140 S0 ; Turn off bed
M84 ; Disable motors
