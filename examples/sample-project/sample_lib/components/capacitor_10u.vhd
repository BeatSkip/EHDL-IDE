-- capacitor_10u.prt.ehd — 10uF timing capacitor (C1), electrolytic or MLCC.
library ieee;
use ieee.std_logic_1164.all;

package capacitor_10u_pkg is
  type capacitor_10u_pin is (P1, P2);
  type pin_map is array (capacitor_10u_pin) of natural;

  constant CAPACITOR_10U_C1206 : pin_map := (P1 => 1, P2 => 2);
  constant CAPACITOR_10U_C0805 : pin_map := (P1 => 1, P2 => 2);

  constant CAPACITOR_10U_C1206_FP : string := "CAPC3216X180N";
  constant CAPACITOR_10U_C0805_FP : string := "CAPC2012X125N";

  constant CAPACITOR_10U_VALUE   : string := "10uF";
  constant CAPACITOR_10U_MFR     : string := "Generic";
  constant CAPACITOR_10U_PARTNUM : string := "CL31A106KBHNNNE";
end package;

library ieee;
use ieee.std_logic_1164.all;

entity CAPACITOR_10U is
  generic (
    PACKAGE_VARIANT : string := "C1206"
  );
  port (
    P1 : inout std_logic;
    P2 : inout std_logic
  );
end entity;

architecture rtl of CAPACITOR_10U is
begin
end architecture;