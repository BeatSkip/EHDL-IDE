-- resistor_330.prt.ehd — 330R LED series resistor (R3).
library ieee;
use ieee.std_logic_1164.all;

package resistor_330_pkg is
  type resistor_330_pin is (P1, P2);
  type pin_map is array (resistor_330_pin) of natural;

  constant RESISTOR_330_R0603 : pin_map := (P1 => 1, P2 => 2);
  constant RESISTOR_330_R0805 : pin_map := (P1 => 1, P2 => 2);

  constant RESISTOR_330_R0603_FP : string := "RESC1608X60N";
  constant RESISTOR_330_R0805_FP : string := "RESC2012X70N";

  constant RESISTOR_330_VALUE   : string := "330R";
  constant RESISTOR_330_MFR     : string := "Generic";
  constant RESISTOR_330_PARTNUM : string := "RC0603FR-07330RL";
end package;

library ieee;
use ieee.std_logic_1164.all;

entity RESISTOR_330 is
  generic (
    PACKAGE_VARIANT : string := "R0603"
  );
  port (
    P1 : inout std_logic;
    P2 : inout std_logic
  );
end entity;

architecture rtl of RESISTOR_330 is
begin
end architecture;