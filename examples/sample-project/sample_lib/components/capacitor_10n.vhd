-- EHDL component: CAPACITOR_10N
-- capacitor_10n.prt.ehd — 10nF control-voltage bypass (C2).
library ieee;
use ieee.std_logic_1164.all;

package capacitor_10n_pkg is
  type capacitor_10n_pin is (Pos, Neg);
  type pin_map is array (capacitor_10n_pin) of natural;

  constant CAPACITOR_10N_C0603 : pin_map := (Pos => 1, Neg => 2);
  constant CAPACITOR_10N_C0603_FP : string := "CAPC1608X85N";

  constant CAPACITOR_10N_C0805 : pin_map := (Pos => 1, Neg => 2);
  constant CAPACITOR_10N_C0805_FP : string := "CAPC2012X125N";

  constant CAPACITOR_10N_VALUE : string := "10nF";
  constant CAPACITOR_10N_MFR : string := "Generic";
  constant CAPACITOR_10N_PARTNUM : string := "CL10B103KB8NNNC";
  constant CAPACITOR_10N_SYMBOL : string := "..\symbols\CPol.ts";
end package;

library ieee;
use ieee.std_logic_1164.all;

entity CAPACITOR_10N is
  generic (
    PACKAGE_VARIANT : string := "C0603"
  );
  port (
    Pos : inout std_logic;
    Neg : inout std_logic
  );
end entity;

architecture rtl of CAPACITOR_10N is
begin
end architecture;
