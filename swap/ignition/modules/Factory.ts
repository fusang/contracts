import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const FactoryModule = buildModule("FactoryModule", (m) => {

  // Deploy FusangFactory
  const fusangFactory = m.contract("FusangFactory");

  return {
    fusangFactory,
  };
});

export default FactoryModule;
