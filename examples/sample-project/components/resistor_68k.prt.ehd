-- resistor_68k.prt.ehd — 68k chip resistor (R2, the timing resistor).
library ieee;
use ieee.std_logic_1164.all;

package resistor_68k_pkg is
  type resistor_68k_pin is (P1, P2);
  type pin_map is array (resistor_68k_pin) of natural;

  constant RESISTOR_68K_R0603 : pin_map := (P1 => 1, P2 => 2);
  constant RESISTOR_68K_R0805 : pin_map := (P1 => 1, P2 => 2);

  constant RESISTOR_68K_R0603_FP : string := "RESC1608X60N";
  constant RESISTOR_68K_R0805_FP : string := "RESC2012X70N";

  constant RESISTOR_68K_VALUE   : string := "68k";
  constant RESISTOR_68K_MFR     : string := "Generic";
  constant RESISTOR_68K_PARTNUM : string := "RC0603FR-0768KL";
end package;

library ieee;
use ieee.std_logic_1164.all;

entity RESISTOR_68K is
  generic (
    PACKAGE_VARIANT : string := "R0603"
  );
  port (
    P1 : inout std_logic;
    P2 : inout std_logic
  );
end entity;

architecture rtl of RESISTOR_68K is
begin
end architecture;