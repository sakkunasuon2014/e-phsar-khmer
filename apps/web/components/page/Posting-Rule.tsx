import { Breadcrumbs } from "@/components/common/Breadcrumbs";
export default function PostingRule() {
  return (
    <div>
      <div className="px-4 py-4  bg-muted">
        <div className="max-w-7xl mx-auto w-full pb-2">
          <Breadcrumbs
            items={[
              { label: "Home", href: "/" },
              { label: "Ads Posting Rule" },
            ]}
          />
        </div>
      </div>
      <main className="w-full bg-muted">
        <div className="pb-20">
          <div className="max-w-4xl mx-auto bg-card px-8 pt-6 pb-4">
            <h1 className="type-page-title text-center mb-6">
              Ad Posting Rule
            </h1>

            <p className="mb-4">
              <strong className="type-card-heading">
                PhsarKhmer&apos;s ad listing policies are intended to:
              </strong>
            </p>

            <ul className="list-decimal pl-6 space-y-1 mb-4">
              <li className="type-body">
                Support government laws and regulations
              </li>
              <li className="type-body">
                Minimize risks to both buyers and sellers
              </li>
              <li className="type-body">
                Provide equal opportunity to all buyers and sellers
              </li>
              <li className="type-body">
                Protect intellectual property rights
              </li>
              <li className="type-body">
                Provide an enjoyable buying & selling experience
              </li>
              <li className="type-body">
                Support the values of the PhsarKhmer Community
              </li>
            </ul>

            <p className="type-card-heading mb-2">
              Every seller must know and follow:
            </p>
            <ul className="list-decimal pl-6 space-y-2 mb-4">
              <li className="type-body">
                <a
                  href="#restricted-items"
                  className="text-[#00a0e9] hover:underline"
                >
                  Rules about Prohibited and Restricted Items - What items can
                  and cannot be listed
                </a>
              </li>
              <li className="type-body">
                <a
                  href="#restricted-services"
                  className="text-[#00a0e9] hover:underline"
                >
                  Rules about Prohibited and Restricted Services
                </a>
              </li>
              <li className="type-body">
                <a
                  href="#birds-animals"
                  className="text-[#00a0e9] hover:underline"
                >
                  Rules about Birds & Animals
                </a>
              </li>
              <li className="type-body">
                <a
                  href="#intellectual-property"
                  className="text-[#00a0e9] hover:underline"
                >
                  Rules about Intellectual Property - Products that have the
                  potential of violating certain copyrights, trademarks, or
                  other rights.
                </a>
              </li>
              <li className="type-body">
                <a
                  href="#prohibited-practices"
                  className="text-[#00a0e9] hover:underline"
                >
                  Prohibited Practices - Actions that are not allowed in listing
                  products for sale and services for offer.
                </a>
              </li>
              <li className="type-body">
                <a
                  href="#miscellaneous"
                  className="text-[#00a0e9] hover:underline"
                >
                  Miscellaneous info - Your listing, information, Advertisement
                </a>
              </li>
              <li className="type-body">
                <a
                  href="#consequences"
                  className="text-[#00a0e9] hover:underline"
                >
                  Consequences of Breach of Listing Policy.
                </a>
                <p className="text-foreground mb-4">
                  Learning about PhsarKhmer&apos;s policies will help you avoid
                  breaking rules (including the law) and aid you in trading with
                  reliable, trustworthy buyers and sellers.
                </p>
              </li>
            </ul>

            <section id="restricted-items" className="scroll-mt-24 mb-4">
              <h2 className="type-section-title mb-2">
                1. Prohibited and Restricted Items
              </h2>
              <ul className="list-decimal pl-6 space-y-1 type-body">
                <li>Adoption of Children & Babies</li>
                <li>Adult / Pornographic Material</li>
                <li>Alcohol</li>
                <li>Animals for fight / race</li>
                <li>Bitcoin</li>
                <li>Blood, Bodily Fluids and Body Parts</li>
                <li>Burglary Tools</li>
                <li>Counterfeit Products</li>
                <li>Database</li>
                <li>E-cigarette</li>
                <li>Electronic Surveillance Equipment</li>
                <li>Embargoed Goods</li>
                <li>Endangered Species</li>
                <li>Event Tickets</li>
                <li>Fire crackers</li>
                <li>Fireworks, Explosives and Explosive Substances</li>
                <li>Government IDs and Licenses</li>
                <li>Hazardous Chemicals</li>
                <li>Hazardous, Restricted, and Perishable Items</li>
                <li>High school diplomas, university certificates, etc.</li>
                <li>Hospital equipment and general aesthetic</li>
                <li>Human Parts and Remains</li>
                <li>Illegal Drugs</li>
                <li>
                  Items that hurt the Laws for the Protection of Historical,
                  Artistic and Cultural significance
                </li>
                <li>Ivory products</li>
                <li>Lottery Tickets, Sweepstakes Entries</li>
                <li>
                  Offensive Material - examples include ethnically or racially
                  offensive material
                </li>
                <li>Pharmaceutical products (prescribed or not)</li>
                <li>
                  Photos of artists/singers/entertainers are not allowed unless
                  with permit
                </li>
                <li>Playing cards</li>
                <li>Police, Army, Navy and Air force Related Items</li>
                <li>Political</li>
                <li>
                  Products without the approval and registration of government
                  agencies such as CNG, Pepper Spray, LPG, Cylinders
                </li>
                <li>Sheeshah or Hookah with flavor content</li>
                <li>Software to unlock phones and video games</li>
                <li>Steroids</li>
                <li>Stocks and Other Securities</li>
                <li>Surveillance Equipment</li>
                <li>Tobacco Products</li>
                <li>Ultrasound machines</li>
                <li>Unrealistic price and other offers</li>
                <li>Used Cosmetics</li>
                <li>Used Undergarments</li>
                <li>Weapons & Knives</li>
                <li>Wildlife Products - mounted specimens, and ivory</li>
                <li>
                  Wholesale/Bulk selling of Branded Products (Electronic
                  Items/Mobiles)
                </li>
              </ul>
            </section>

            <section id="restricted-services" className="scroll-mt-24 mb-4">
              <h2 className="type-section-title mb-2">
                2. Prohibited and Restricted Services
              </h2>
              <ul className="list-decimal pl-6 space-y-1 type-body">
                <li>Adult Massage services</li>
                <li>
                  Any kind of government service - Only consultancy/guidance is
                  allowed
                </li>
                <li>Bulk SMS / Email services</li>
                <li>Escorts</li>
                <li>Multi-Level Marketing Services</li>
                <li>
                  People looking for relationship, dating and / or friendship
                </li>
                <li>Quick get-rich schemes</li>
                <li>Surrogacy</li>
              </ul>
            </section>

            <section id="birds-animals" className="scroll-mt-24 mb-4">
              <h2 className="type-section-title mb-2">
                3. Rules about Birds & Animals
              </h2>
              <ul className="list-decimal pl-6 space-y-1 type-body">
                <li>
                  In birds, we only allow Chickens, Roosters, Chicks, Geese,
                  Emus, Pigeons, Turkeys & Ducks
                </li>
                <li>
                  In Animals, we only allow Dogs, Cats, Fishes, Bovine, Pigs,
                  Equines, Rabbits, Hamsters, Guinea Pigs & Goats
                </li>
                <li>
                  Birds and animals used for fighting or racing is strictly
                  prohibited
                </li>
                <li>
                  PhsarKhmer only allows ads selling Meat & Eggs of the
                  animals/birds listed above with an exception of Cow meat.
                </li>
                <li>
                  We do not allow animals & birds which fall under the
                  restricted category.
                </li>
              </ul>
            </section>

            <section id="intellectual-property" className="scroll-mt-24 mb-4">
              <h2 className="type-section-title mb-2">
                4. The following items are restricted or prohibited because they
                would potentially infringe on intellectual property rights:
              </h2>
              <ul className="list-decimal pl-6 space-y-1 type-body">
                <li>Counterfeit items</li>
                <li>Faces, names and signatures and autographed items</li>
                <li>Software & movie piracy</li>
                <li>Watermark/logo/URL of other websites</li>
                <li>New Luxury brands</li>
              </ul>
            </section>

            <section id="prohibited-practices" className="scroll-mt-24 mb-4">
              <h2 className="type-section-title mb-2">
                5. Prohibited Practices
              </h2>
              <p className="text-foreground mb-4">
                To promote a safe, fair and enjoyable experience, PhsarKhmer has
                established a set of rules and policies for item listings. You
                are requested, not to ---
              </p>
              <ul className="list-decimal pl-6 space-y-1 type-body">
                <li>
                  Post Duplicate Ad listings - Any ad posted more than once with
                  the same content or Title in the same city and category would
                  be considered as a Duplicate Ad. We advise you to post
                  multiple ads only if you have different items or services for
                  sale. All duplicate ads would be deleted and posters penalized
                  if the problem persists.
                </li>
                <li>
                  Post Mature Audience/Sexually oriented material: Classifieds
                  relating to items that includes items intended for use in
                  sexual activity would not be permitted. Please also be aware
                  that titles with graphic adult language are inappropriate,
                  regardless of the item contained in the listing itself.
                </li>
                <li>Write Misleading Titles</li>
                <li>Upload Inappropriate/wrong picture with the Ad</li>
                <li>List items in inappropriate categories</li>
                <li>Misrepresent the item location</li>
                <li>Quote Unrealistic Price</li>
              </ul>
            </section>

            <section id="miscellaneous" className="scroll-mt-24 mb-4">
              <h2 className="type-section-title mb-2">6. Miscellaneous Info</h2>
              <ul className="list-decimal pl-6 space-y-1 type-body">
                <li>
                  Shall not be defamatory, trade libelous, unlawfully
                  threatening or unlawfully harassing. Further shall not be
                  fraudulent, misrepresenting, misleading or pertain to the sale
                  of any illegal, stolen goods and or services which do not
                  belong to you or you do not have the authority for.
                </li>
                <li>
                  Shall not be allowed to libel anyone or include hate,
                  derogatory, slanderous speech directed at individuals or
                  groups. You should not advocate violence against other users
                  or individuals or groups.
                </li>
                <li>
                  Shall not be allowed to libel anyone or include hate,
                  derogatory, slanderous speech directed at individuals or
                  groups. You should not advocate violence against other users
                  or individuals or groups.
                </li>
              </ul>
            </section>
            <section id="consequences" className="scroll-mt-24 mb-4">
              <h2 className="type-section-title mb-2">
                7. Consequences of Breach of Listing Policy
              </h2>
              <p className="text-foreground px-6 type-body">
                Users who violate the prohibited items policy and or the
                restricted items policy may be subject to the following actions
              </p>
              <ul className="list-decimal pl-6 space-y-1 type-body">
                <li>Permanent blacklisting from PhsarKhmer community</li>
                <li>Reporting to Law Enforcement or Appropriate Authorities</li>
              </ul>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
