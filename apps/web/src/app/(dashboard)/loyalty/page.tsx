"use client";

import { useState } from "react";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@restai/ui/components/tabs";
import { Star, Users, Gift, Ticket } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { LoyaltyStats } from "./_components/loyalty-stats";
import { ProgramsTab } from "./_components/programs-tab";
import { CustomersTab } from "./_components/customers-tab";
import { RewardsTab } from "./_components/rewards-tab";
import { CouponsTab } from "./_components/coupons-tab";

export default function LoyaltyPage() {
  const [tab, setTab] = useState("programs");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fidelizacion"
        description="Gestiona tus clientes, programa de puntos, recompensas y cupones"
      />

      <LoyaltyStats />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="programs">
            <Star className="h-4 w-4 mr-2" />
            Programas
          </TabsTrigger>
          <TabsTrigger value="customers">
            <Users className="h-4 w-4 mr-2" />
            Clientes
          </TabsTrigger>
          <TabsTrigger value="rewards">
            <Gift className="h-4 w-4 mr-2" />
            Recompensas
          </TabsTrigger>
          <TabsTrigger value="coupons">
            <Ticket className="h-4 w-4 mr-2" />
            Cupones
          </TabsTrigger>
        </TabsList>

        <TabsContent value="programs">
          <ProgramsTab />
        </TabsContent>
        <TabsContent value="customers">
          <CustomersTab />
        </TabsContent>
        <TabsContent value="rewards">
          <RewardsTab />
        </TabsContent>
        <TabsContent value="coupons">
          <CouponsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
